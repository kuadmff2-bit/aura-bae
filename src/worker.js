const SESSION_COOKIE = "aura_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
// Cloudflare Workers currently rejects PBKDF2 iteration counts above 100,000.
const PASSWORD_ITERATIONS = 100000;
const VEHICLES = {
  mototaxi: { name: "Mototáxi", minimum: 7, extraKm: 2 },
  motocarro: { name: "Motocarro", minimum: 10, extraKm: 2.5 },
  taxi: { name: "Carro", minimum: 12, extraKm: 3 }
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhooks/")) {
        return await routeApi(request, env, ctx, url);
      }
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
      headers.set("X-Frame-Options", "DENY");
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    } catch (error) {
      console.error("Aura Bae request error", error?.message || error);
      return json({ error: "Não foi possível concluir a operação." }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    if (String(env.AUTOMATIC_PAYOUTS_ENABLED).toLowerCase() !== "true") return;
    ctx.waitUntil(processDailyPayouts(env));
  }
};

async function routeApi(request, env, ctx, url) {
  const { pathname } = url;
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, service: "Aura Bae API", asaas: env.ASAAS_ENVIRONMENT || "sandbox" });
  }
  if (pathname === "/api/config" && request.method === "GET") {
    return json({
      supportPhone: env.SUPPORT_PHONE,
      platformPercent: numberEnv(env.PLATFORM_PERCENT, 10),
      fixedFee: numberEnv(env.PLATFORM_FIXED_FEE, 1.5),
      paymentsConfigured: Boolean(env.ASAAS_API_KEY),
      environment: env.ASAAS_ENVIRONMENT || "sandbox"
    });
  }
  if (pathname === "/api/setup/status" && request.method === "GET") return setupStatus(env);
  if (pathname === "/api/setup/admin" && request.method === "POST") return setupAdmin(request, env);
  if (pathname === "/api/auth/register" && request.method === "POST") return register(request, env);
  if (pathname === "/api/auth/login" && request.method === "POST") return login(request, env);
  if (pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  if (pathname === "/api/auth/me" && request.method === "GET") return me(request, env);
  if (pathname === "/api/driver/status" && request.method === "POST") return updateDriverStatus(request, env);
  if (pathname === "/api/drivers/nearby" && request.method === "GET") return nearbyDrivers(request, env, url);
  if (pathname === "/api/rides" && request.method === "POST") return createRide(request, env);
  if (pathname === "/api/rides/current" && request.method === "GET") return currentRide(request, env);
  if (pathname === "/api/rides/available" && request.method === "GET") return availableRides(request, env);
  if (pathname === "/api/admin/summary" && request.method === "GET") return adminSummary(request, env);
  if (pathname === "/api/admin/drivers" && request.method === "GET") return adminDrivers(request, env);
  if (pathname === "/api/admin/operations" && request.method === "GET") return adminOperations(request, env);
  if (pathname === "/api/admin/payouts/preview" && request.method === "GET") return payoutPreview(request, env);
  if (pathname === "/webhooks/asaas" && request.method === "POST") return asaasWebhook(request, env, ctx);

  const rideAction = pathname.match(/^\/api\/rides\/([^/]+)\/(accept|start|arrive|cash-received|cancel|payment|rate)$/);
  if (rideAction) return handleRideAction(request, env, rideAction[1], rideAction[2]);
  const driverDecision = pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/(approve|reject|suspend)$/);
  if (driverDecision && request.method === "POST") return decideDriver(request, env, driverDecision[1], driverDecision[2]);
  return json({ error: "Rota não encontrada." }, 404);
}

async function setupStatus(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").first();
  return json({ needsAdmin: Number(row?.total || 0) === 0 });
}

async function setupAdmin(request, env) {
  const existing = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").first();
  if (Number(existing?.total || 0) > 0) return json({ error: "O administrador já foi configurado." }, 409);
  const body = await readJson(request);
  if (!body || !(await secureEqual(String(body.setupToken || ""), String(env.ADMIN_SETUP_TOKEN || "")))) {
    return json({ error: "Token de configuração inválido." }, 403);
  }
  const name = cleanName(body.name || env.ADMIN_NAME);
  const phone = normalizePhone(body.phone || env.ADMIN_PHONE);
  const cpf = normalizeCpf(body.cpf);
  const password = String(body.password || "");
  const validation = validateAccount({ name, phone, cpf, password });
  if (validation) return json({ error: validation }, 400);
  const passwordData = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users
    (id, name, phone, cpf, password_hash, password_salt, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active')`)
    .bind(id, name, phone, cpf, passwordData.hash, passwordData.salt).run();
  return createSessionResponse(env, await getUserById(env, id), 201);
}

async function register(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "Dados inválidos." }, 400);
  const role = body.role === "driver" ? "driver" : "passenger";
  const name = cleanName(body.name);
  const phone = normalizePhone(body.phone);
  const cpf = normalizeCpf(body.cpf);
  const password = String(body.password || "");
  const validation = validateAccount({ name, phone, cpf, password });
  if (validation) return json({ error: validation }, 400);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE phone = ? OR cpf = ? LIMIT 1").bind(phone, cpf).first();
  if (existing) return json({ error: "Este telefone ou CPF já possui cadastro." }, 409);

  let vehicleType = null;
  let vehicleModel = null;
  let pixKey = null;
  let pixKeyType = null;
  if (role === "driver") {
    vehicleType = VEHICLES[body.vehicleType] ? body.vehicleType : null;
    vehicleModel = cleanText(body.vehicleModel, 120);
    pixKey = cleanText(body.pixKey, 120);
    pixKeyType = ["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"].includes(body.pixKeyType) ? body.pixKeyType : null;
    if (!vehicleType || vehicleModel.length < 2) return json({ error: "Informe a categoria e o modelo do veículo." }, 400);
    if (!pixKey || !pixKeyType) return json({ error: "Informe a chave Pix e o tipo para receber os repasses." }, 400);
  }

  const passwordData = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users
    (id, name, phone, cpf, password_hash, password_salt, role, status, vehicle_type, vehicle_model, pix_key, pix_key_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, name, phone, cpf, passwordData.hash, passwordData.salt, role, role === "driver" ? "pending" : "active", vehicleType, vehicleModel, pixKey, pixKeyType).run();
  return createSessionResponse(env, await getUserById(env, id), 201);
}

async function login(request, env) {
  const body = await readJson(request);
  const phone = normalizePhone(body?.phone);
  const password = String(body?.password || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE phone = ? LIMIT 1").bind(phone).first();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    return json({ error: "Telefone ou senha incorretos." }, 401);
  }
  if (user.status === "suspended" || user.status === "rejected") return json({ error: "Este cadastro não está liberado. Fale com o suporte." }, 403);
  return createSessionResponse(env, user);
}

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": expiredSessionCookie() });
}

async function me(request, env) {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  return json({ user: publicUser(user) });
}

async function updateDriverStatus(request, env) {
  const user = await requireRole(request, env, "driver");
  if (user instanceof Response) return user;
  if (user.status !== "approved") return json({ error: "Seu cadastro ainda não foi aprovado." }, 403);
  const body = await readJson(request);
  const online = Boolean(body?.online);
  const lat = Number(body?.latitude);
  const lng = Number(body?.longitude);
  if (online && !isBarreirinhaPoint(lat, lng)) return json({ error: "Ative a localização dentro de Barreirinha." }, 400);
  await env.DB.prepare(`INSERT INTO driver_locations (driver_id, latitude, longitude, is_online, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(driver_id) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude,
    is_online = excluded.is_online, updated_at = CURRENT_TIMESTAMP`)
    .bind(user.id, Number.isFinite(lat) ? lat : -2.79333, Number.isFinite(lng) ? lng : -57.07, online ? 1 : 0).run();
  return json({ online });
}

async function nearbyDrivers(request, env, url) {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const vehicle = url.searchParams.get("vehicle");
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!VEHICLES[vehicle] || !isBarreirinhaPoint(lat, lng)) return json({ error: "Localização ou transporte inválido." }, 400);
  const rows = await env.DB.prepare(`SELECT u.id, u.name, u.vehicle_type, dl.latitude, dl.longitude, dl.updated_at
    FROM driver_locations dl JOIN users u ON u.id = dl.driver_id
    WHERE dl.is_online = 1 AND u.status = 'approved' AND u.vehicle_type = ?
    AND datetime(dl.updated_at) >= datetime('now', '-3 minutes')`).bind(vehicle).all();
  const drivers = (rows.results || []).map(row => ({
    id: row.id,
    name: firstName(row.name),
    vehicleType: row.vehicle_type,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceKm: round(haversineKm({ lat, lng }, { lat: row.latitude, lng: row.longitude }), 2)
  })).sort((a, b) => a.distanceKm - b.distanceKm);
  return json({ drivers });
}

async function createRide(request, env) {
  const user = await requireRole(request, env, "passenger");
  if (user instanceof Response) return user;
  const body = await readJson(request);
  const vehicle = body?.vehicleType;
  const origin = normalizePoint(body?.origin);
  const destination = normalizePoint(body?.destination);
  const paymentMethod = body?.paymentMethod === "CASH" ? "CASH" : "PIX";
  if (!VEHICLES[vehicle] || !origin || !destination) return json({ error: "Escolha o transporte, a saída e o destino." }, 400);
  const openRide = await env.DB.prepare(`SELECT id FROM rides WHERE passenger_id = ? AND status NOT IN ('completed','cancelled') LIMIT 1`).bind(user.id).first();
  if (openRide) return json({ error: "Você já possui uma corrida em andamento.", rideId: openRide.id }, 409);
  const route = await calculateRoute(origin, destination);
  if (!route) return json({ error: "Não encontramos uma rota pelas ruas entre esses pontos." }, 422);
  const pricing = calculatePricing(vehicle, route.distanceKm, env);
  const id = `AB-${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO rides
    (id, passenger_id, vehicle_type, origin_lat, origin_lng, destination_lat, destination_lng,
     distance_km, duration_minutes, fare_cents, fixed_fee_cents, total_cents, driver_share_cents,
     platform_share_cents, payment_method, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'searching')`)
    .bind(id, user.id, vehicle, origin.lat, origin.lng, destination.lat, destination.lng,
      route.distanceKm, route.durationMinutes, pricing.fareCents, pricing.fixedFeeCents,
      pricing.totalCents, pricing.driverShareCents, pricing.platformShareCents, paymentMethod).run();
  return json({ ride: await getRide(env, id) }, 201);
}

async function currentRide(request, env) {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const field = user.role === "driver" ? "driver_id" : "passenger_id";
  const ride = await env.DB.prepare(`SELECT * FROM rides WHERE ${field} = ? AND status NOT IN ('completed','cancelled') ORDER BY created_at DESC LIMIT 1`).bind(user.id).first();
  return json({ ride: ride ? publicRide(ride) : null });
}

async function availableRides(request, env) {
  const user = await requireRole(request, env, "driver");
  if (user instanceof Response) return user;
  if (user.status !== "approved") return json({ error: "Cadastro aguardando aprovação." }, 403);
  const location = await env.DB.prepare("SELECT * FROM driver_locations WHERE driver_id = ? AND is_online = 1").bind(user.id).first();
  if (!location) return json({ rides: [] });
  const rows = await env.DB.prepare(`SELECT r.*, u.name AS passenger_name FROM rides r JOIN users u ON u.id = r.passenger_id
    WHERE r.status = 'searching' AND r.vehicle_type = ? ORDER BY r.created_at ASC LIMIT 20`).bind(user.vehicle_type).all();
  const rides = (rows.results || []).map(row => ({
    ...publicRide(row),
    passengerName: firstName(row.passenger_name),
    pickupDistanceKm: round(haversineKm({ lat: location.latitude, lng: location.longitude }, { lat: row.origin_lat, lng: row.origin_lng }), 2)
  })).sort((a, b) => a.pickupDistanceKm - b.pickupDistanceKm);
  return json({ rides });
}

async function handleRideAction(request, env, rideId, action) {
  if (action === "payment" && request.method === "GET") return paymentStatus(request, env, rideId);
  if (request.method !== "POST") return json({ error: "Método inválido." }, 405);
  if (action === "accept") return acceptRide(request, env, rideId);
  if (action === "start") return startRide(request, env, rideId);
  if (action === "arrive") return arriveRide(request, env, rideId);
  if (action === "cash-received") return confirmCash(request, env, rideId);
  if (action === "cancel") return cancelRide(request, env, rideId);
  if (action === "rate") return rateRide(request, env, rideId);
  return json({ error: "Ação inválida." }, 404);
}

async function acceptRide(request, env, rideId) {
  const driver = await requireRole(request, env, "driver");
  if (driver instanceof Response) return driver;
  if (driver.status !== "approved") return json({ error: "Cadastro não aprovado." }, 403);
  const result = await env.DB.prepare(`UPDATE rides SET driver_id = ?, status = 'accepted', accepted_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'searching' AND driver_id IS NULL AND vehicle_type = ?`)
    .bind(driver.id, rideId, driver.vehicle_type).run();
  if (!result.meta?.changes) return json({ error: "Esta corrida já foi aceita por outro motorista." }, 409);
  return json({ ride: await getRide(env, rideId) });
}

async function startRide(request, env, rideId) {
  const driver = await requireRole(request, env, "driver");
  if (driver instanceof Response) return driver;
  const result = await env.DB.prepare("UPDATE rides SET status = 'in_progress' WHERE id = ? AND driver_id = ? AND status = 'accepted'").bind(rideId, driver.id).run();
  if (!result.meta?.changes) return json({ error: "A corrida não pode ser iniciada." }, 409);
  return json({ ride: await getRide(env, rideId) });
}

async function arriveRide(request, env, rideId) {
  const driver = await requireRole(request, env, "driver");
  if (driver instanceof Response) return driver;
  let ride = await env.DB.prepare("SELECT * FROM rides WHERE id = ? AND driver_id = ? LIMIT 1").bind(rideId, driver.id).first();
  if (!ride || !["in_progress", "arrived", "payment_pending"].includes(ride.status)) return json({ error: "Esta corrida não pode ser finalizada agora." }, 409);
  if (ride.payment_method === "CASH") {
    await env.DB.prepare("UPDATE rides SET status = 'arrived', arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(rideId).run();
    return json({ ride: await getRide(env, rideId), cashRequired: true });
  }
  if (!ride.asaas_payment_id) {
    await env.DB.prepare("UPDATE rides SET status = 'arrived', arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(rideId).run();
    await createPixCharge(env, ride);
  } else {
    await ensureQrCode(env, ride.id, ride.asaas_payment_id);
  }
  ride = await getRide(env, rideId);
  const qr = await env.DB.prepare("SELECT payload, encoded_image, expiration_date FROM payment_qr_codes WHERE ride_id = ?").bind(rideId).first();
  return json({ ride: publicRide(ride), payment: qr ? publicQr(qr) : null });
}

async function paymentStatus(request, env, rideId) {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  let ride = await getRide(env, rideId);
  if (!ride || !canAccessRide(user, ride)) return json({ error: "Corrida não encontrada." }, 404);
  if (ride.asaas_payment_id && !["paid", "completed"].includes(ride.status)) {
    try {
      const payment = await asaasFetch(env, `/payments/${encodeURIComponent(ride.asaas_payment_id)}`);
      if (payment.status === "RECEIVED") await markRidePaid(env, ride, payment.id, "PAYMENT_RECEIVED");
      ride = await getRide(env, rideId);
    } catch (error) {
      console.error("Payment refresh failed", error?.message || error);
    }
  }
  const qr = await env.DB.prepare("SELECT payload, encoded_image, expiration_date FROM payment_qr_codes WHERE ride_id = ?").bind(rideId).first();
  return json({ ride: publicRide(ride), payment: qr ? publicQr(qr) : null });
}

async function confirmCash(request, env, rideId) {
  const driver = await requireRole(request, env, "driver");
  if (driver instanceof Response) return driver;
  const ride = await env.DB.prepare("SELECT * FROM rides WHERE id = ? AND driver_id = ? AND payment_method = 'CASH' AND status = 'arrived'").bind(rideId, driver.id).first();
  if (!ride) return json({ error: "Pagamento em dinheiro não está aguardando confirmação." }, 409);
  const debt = ride.platform_share_cents + ride.fixed_fee_cents;
  const result = await env.DB.prepare("UPDATE rides SET status = 'paid', payment_status = 'RECEIVED_IN_CASH', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'arrived'").bind(rideId).run();
  if (result.meta?.changes) {
    await env.DB.prepare(`INSERT INTO ledger_entries (id, user_id, ride_id, kind, amount_cents, description)
      VALUES (?, ?, ?, 'cash_debt', ?, ?)`)
      .bind(crypto.randomUUID(), driver.id, rideId, -debt, "Comissão e taxa de corrida recebida em dinheiro").run();
  }
  return json({ ride: publicRide(await getRide(env, rideId)) });
}

async function cancelRide(request, env, rideId) {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const ride = await getRide(env, rideId);
  if (!ride || !canAccessRide(user, ride) || ["paid", "completed", "cancelled"].includes(ride.status)) return json({ error: "A corrida não pode ser cancelada." }, 409);
  const fee = ["accepted", "in_progress", "arrived", "payment_pending"].includes(ride.status) ? Math.round(ride.fare_cents * 0.10) : 0;
  await env.DB.prepare("UPDATE rides SET status = 'cancelled', cancel_fee_cents = ? WHERE id = ?").bind(fee, rideId).run();
  return json({ cancelled: true, cancellationFeeCents: fee });
}

async function rateRide(request, env, rideId) {
  const passenger = await requireRole(request, env, "passenger");
  if (passenger instanceof Response) return passenger;
  const body = await readJson(request);
  const stars = Number(body?.stars);
  const ride = await env.DB.prepare("SELECT * FROM rides WHERE id = ? AND passenger_id = ? AND status = 'paid'").bind(rideId, passenger.id).first();
  if (!ride || !ride.driver_id || !Number.isInteger(stars) || stars < 1 || stars > 5) return json({ error: "Avaliação inválida." }, 400);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ratings (id, ride_id, passenger_id, driver_id, stars) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), rideId, passenger.id, ride.driver_id, stars),
    env.DB.prepare("UPDATE rides SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(rideId)
  ]);
  return json({ completed: true });
}

async function adminSummary(request, env) {
  const admin = await requireRole(request, env, "admin");
  if (admin instanceof Response) return admin;
  const [drivers, pending, rides, gross, balances] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS value FROM users WHERE role = 'driver' AND status = 'approved'"),
    env.DB.prepare("SELECT COUNT(*) AS value FROM users WHERE role = 'driver' AND status = 'pending'"),
    env.DB.prepare("SELECT COUNT(*) AS value FROM rides"),
    env.DB.prepare("SELECT COALESCE(SUM(total_cents), 0) AS value FROM rides WHERE status IN ('paid','completed')"),
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM ledger_entries WHERE user_id IS NOT NULL")
  ]);
  return json({
    approvedDrivers: Number(drivers.results?.[0]?.value || 0),
    pendingDrivers: Number(pending.results?.[0]?.value || 0),
    rides: Number(rides.results?.[0]?.value || 0),
    grossCents: Number(gross.results?.[0]?.value || 0),
    driverBalancesCents: Number(balances.results?.[0]?.value || 0)
  });
}

async function adminDrivers(request, env) {
  const admin = await requireRole(request, env, "admin");
  if (admin instanceof Response) return admin;
  const rows = await env.DB.prepare(`SELECT id, name, phone, cpf, status, vehicle_type, vehicle_model, pix_key_type, created_at
    FROM users WHERE role = 'driver' ORDER BY created_at DESC`).all();
  return json({ drivers: rows.results || [] });
}

async function adminOperations(request, env) {
  const admin = await requireRole(request, env, "admin");
  if (admin instanceof Response) return admin;
  const [onlineDrivers, activeRides] = await env.DB.batch([
    env.DB.prepare(`SELECT u.id, u.name, u.phone, u.vehicle_type, u.vehicle_model,
      dl.latitude, dl.longitude, dl.updated_at
      FROM driver_locations dl
      JOIN users u ON u.id = dl.driver_id
      WHERE u.role = 'driver' AND u.status = 'approved' AND dl.is_online = 1
      AND datetime(dl.updated_at) >= datetime('now', '-3 minutes')
      ORDER BY dl.updated_at DESC`),
    env.DB.prepare(`SELECT r.id, r.vehicle_type, r.status, r.payment_method,
      r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng,
      r.distance_km, r.duration_minutes, r.total_cents, r.created_at,
      passenger.name AS passenger_name, passenger.phone AS passenger_phone,
      driver.name AS driver_name, driver.phone AS driver_phone
      FROM rides r
      JOIN users passenger ON passenger.id = r.passenger_id
      LEFT JOIN users driver ON driver.id = r.driver_id
      WHERE r.status NOT IN ('completed', 'cancelled')
      ORDER BY r.created_at DESC LIMIT 100`)
  ]);
  return json({
    generatedAt: new Date().toISOString(),
    onlineDrivers: onlineDrivers.results || [],
    activeRides: activeRides.results || []
  });
}

async function decideDriver(request, env, driverId, action) {
  const admin = await requireRole(request, env, "admin");
  if (admin instanceof Response) return admin;
  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "suspended";
  const result = await env.DB.prepare("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'driver'").bind(status, driverId).run();
  if (!result.meta?.changes) return json({ error: "Motorista não encontrado." }, 404);
  if (status !== "approved") await env.DB.prepare("UPDATE driver_locations SET is_online = 0 WHERE driver_id = ?").bind(driverId).run();
  return json({ status });
}

async function payoutPreview(request, env) {
  const admin = await requireRole(request, env, "admin");
  if (admin instanceof Response) return admin;
  const rows = await driverBalances(env);
  return json({ payoutsEnabled: String(env.AUTOMATIC_PAYOUTS_ENABLED).toLowerCase() === "true", drivers: rows });
}

async function createPixCharge(env, ride) {
  if (!env.ASAAS_API_KEY) throw new Error("ASAAS_API_KEY não configurada");
  const passenger = await getUserById(env, ride.passenger_id);
  let customerId = passenger.asaas_customer_id;
  if (!customerId) {
    const customer = await asaasFetch(env, "/customers", {
      method: "POST",
      body: {
        name: passenger.name,
        cpfCnpj: passenger.cpf,
        mobilePhone: passenger.phone,
        externalReference: passenger.id,
        notificationDisabled: true
      }
    });
    customerId = customer.id;
    await env.DB.prepare("UPDATE users SET asaas_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(customerId, passenger.id).run();
  }
  const payment = await asaasFetch(env, "/payments", {
    method: "POST",
    body: {
      customer: customerId,
      billingType: "PIX",
      value: ride.total_cents / 100,
      dueDate: todayManaus(),
      description: `Corrida Aura Bae ${ride.id}`,
      externalReference: ride.id
    }
  });
  await env.DB.prepare("UPDATE rides SET asaas_payment_id = ?, payment_status = ?, status = 'payment_pending' WHERE id = ?")
    .bind(payment.id, payment.status || "PENDING", ride.id).run();
  await ensureQrCode(env, ride.id, payment.id);
}

async function ensureQrCode(env, rideId, paymentId) {
  const existing = await env.DB.prepare("SELECT ride_id FROM payment_qr_codes WHERE ride_id = ?").bind(rideId).first();
  if (existing) return;
  const qr = await asaasFetch(env, `/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
  await env.DB.prepare(`INSERT INTO payment_qr_codes (ride_id, payload, encoded_image, expiration_date)
    VALUES (?, ?, ?, ?) ON CONFLICT(ride_id) DO UPDATE SET payload = excluded.payload,
    encoded_image = excluded.encoded_image, expiration_date = excluded.expiration_date, created_at = CURRENT_TIMESTAMP`)
    .bind(rideId, qr.payload, qr.encodedImage, qr.expirationDate || null).run();
}

async function asaasWebhook(request, env, ctx) {
  const receivedToken = request.headers.get("asaas-access-token") || "";
  if (!env.ASAAS_WEBHOOK_TOKEN || !(await secureEqual(receivedToken, env.ASAAS_WEBHOOK_TOKEN))) return json({ error: "Não autorizado." }, 401);
  const event = await readJson(request);
  if (!event?.id || !event?.event) return json({ error: "Evento inválido." }, 400);
  const duplicate = await env.DB.prepare("SELECT event_id FROM webhook_events WHERE event_id = ?").bind(event.id).first();
  if (duplicate) return json({ ok: true, duplicate: true });
  await processAsaasEvent(env, event);
  await env.DB.prepare("INSERT OR IGNORE INTO webhook_events (event_id, event_type, payload) VALUES (?, ?, ?)")
    .bind(event.id, event.event, JSON.stringify(event)).run();
  return json({ ok: true });
}

async function processAsaasEvent(env, event) {
  const payment = event.payment;
  if (!payment?.id) return;
  const ride = await env.DB.prepare("SELECT * FROM rides WHERE asaas_payment_id = ? LIMIT 1").bind(payment.id).first();
  if (!ride) return;
  if (event.event === "PAYMENT_RECEIVED") await markRidePaid(env, ride, payment.id, event.event);
  else if (["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"].includes(event.event)) {
    await env.DB.prepare("UPDATE rides SET payment_status = ? WHERE id = ?").bind(event.event, ride.id).run();
  } else {
    await env.DB.prepare("UPDATE rides SET payment_status = ? WHERE id = ?").bind(payment.status || event.event, ride.id).run();
  }
}

async function markRidePaid(env, ride, paymentId, paymentStatus) {
  const result = await env.DB.prepare(`UPDATE rides SET status = 'paid', payment_status = ?, paid_at = CURRENT_TIMESTAMP
    WHERE id = ? AND asaas_payment_id = ? AND status NOT IN ('paid','completed')`)
    .bind(paymentStatus, ride.id, paymentId).run();
  if (!result.meta?.changes) return;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ledger_entries (id, user_id, ride_id, kind, amount_cents, description)
      VALUES (?, ?, ?, 'driver_credit', ?, ?)`)
      .bind(crypto.randomUUID(), ride.driver_id, ride.id, ride.driver_share_cents, "Crédito da corrida paga por Pix"),
    env.DB.prepare(`INSERT INTO ledger_entries (id, user_id, ride_id, kind, amount_cents, description)
      VALUES (?, NULL, ?, 'platform_credit', ?, ?)`)
      .bind(crypto.randomUUID(), ride.id, ride.platform_share_cents + ride.fixed_fee_cents, "Comissão e taxa da Aura Bae")
  ]);
}

async function processDailyPayouts(env) {
  const balances = await driverBalances(env);
  const payoutDay = todayManaus();
  for (const driver of balances) {
    if (driver.balanceCents <= 0 || !driver.pixKey || !driver.pixKeyType) continue;
    const existing = await env.DB.prepare("SELECT id FROM payouts WHERE driver_id = ? AND payout_day = ?").bind(driver.id, payoutDay).first();
    if (existing) continue;
    const payoutId = crypto.randomUUID();
    try {
      const transfer = await asaasFetch(env, "/transfers", {
        method: "POST",
        body: {
          value: driver.balanceCents / 100,
          operationType: "PIX",
          pixAddressKey: driver.pixKey,
          pixAddressKeyType: driver.pixKeyType,
          description: `Repasse diário Aura Bae ${payoutDay}`,
          externalReference: payoutId
        }
      });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO payouts (id, driver_id, amount_cents, status, asaas_transfer_id, payout_day)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(payoutId, driver.id, driver.balanceCents, transfer.status === "DONE" ? "done" : "processing", transfer.id || null, payoutDay),
        env.DB.prepare(`INSERT INTO ledger_entries (id, user_id, kind, amount_cents, description)
          VALUES (?, ?, 'payout', ?, ?)`)
          .bind(crypto.randomUUID(), driver.id, -driver.balanceCents, `Repasse Pix ${payoutDay}`)
      ]);
    } catch (error) {
      await env.DB.prepare(`INSERT OR IGNORE INTO payouts (id, driver_id, amount_cents, status, failure_reason, payout_day)
        VALUES (?, ?, ?, 'failed', ?, ?)`)
        .bind(payoutId, driver.id, driver.balanceCents, cleanText(error?.message || "Falha no repasse", 300), payoutDay).run();
    }
  }
}

async function driverBalances(env) {
  const result = await env.DB.prepare(`SELECT u.id, u.name, u.pix_key, u.pix_key_type,
    COALESCE(SUM(l.amount_cents), 0) AS balance_cents
    FROM users u LEFT JOIN ledger_entries l ON l.user_id = u.id
    WHERE u.role = 'driver' AND u.status = 'approved'
    GROUP BY u.id HAVING balance_cents != 0 ORDER BY u.name`).all();
  return (result.results || []).map(row => ({
    id: row.id,
    name: row.name,
    balanceCents: Number(row.balance_cents || 0),
    pixKey: row.pix_key,
    pixKeyType: row.pix_key_type
  }));
}

async function asaasFetch(env, path, options = {}) {
  const production = (env.ASAAS_ENVIRONMENT || "sandbox") === "production";
  const baseUrl = production ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "access_token": env.ASAAS_API_KEY,
      "user-agent": "AuraBae/1.0 (kuadmff2@gmail.com)"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = data.errors?.map(item => item.description).filter(Boolean).join(" ") || "Falha na comunicação com o Asaas.";
    throw new Error(description);
  }
  return data;
}

async function calculateRoute(origin, destination) {
  const endpoint = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=false`;
  const response = await fetch(endpoint, { headers: { "user-agent": "AuraBae/1.0" } });
  if (!response.ok) return null;
  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) return null;
  return { distanceKm: round(route.distance / 1000, 3), durationMinutes: Math.max(1, Math.round(route.duration / 60)) };
}

function calculatePricing(vehicle, distanceKm, env) {
  const info = VEHICLES[vehicle];
  const fare = Math.ceil((info.minimum + Math.max(0, distanceKm - 2) * info.extraKm) * 2) / 2;
  const fareCents = Math.round(fare * 100);
  const fixedFeeCents = Math.round(numberEnv(env.PLATFORM_FIXED_FEE, 1.5) * 100);
  const platformShareCents = Math.round(fareCents * numberEnv(env.PLATFORM_PERCENT, 10) / 100);
  return { fareCents, fixedFeeCents, totalCents: fareCents + fixedFeeCents, platformShareCents, driverShareCents: fareCents - platformShareCents };
}

async function createSessionResponse(env, user, status = 200) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), user.id, expires).run();
  return json({ user: publicUser(user) }, status, { "Set-Cookie": sessionCookie(token) });
}

async function requireUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return json({ error: "Faça login para continuar." }, 401);
  const user = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now') LIMIT 1`).bind(await sha256(token)).first();
  if (!user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401, { "Set-Cookie": expiredSessionCookie() });
  return user;
}

async function requireRole(request, env, role) {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (user.role !== role) return json({ error: "Você não possui permissão para esta ação." }, 403);
  return user;
}

async function getUserById(env, id) { return env.DB.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(id).first(); }
async function getRide(env, id) { return env.DB.prepare("SELECT * FROM rides WHERE id = ? LIMIT 1").bind(id).first(); }

function publicUser(user) {
  return {
    id: user.id, name: user.name, phone: user.phone, role: user.role, status: user.status,
    vehicleType: user.vehicle_type || null, vehicleModel: user.vehicle_model || null,
    hasPixKey: Boolean(user.pix_key)
  };
}

function publicRide(ride) {
  return {
    id: ride.id,
    passengerId: ride.passenger_id,
    driverId: ride.driver_id,
    vehicleType: ride.vehicle_type,
    origin: { lat: ride.origin_lat, lng: ride.origin_lng },
    destination: { lat: ride.destination_lat, lng: ride.destination_lng },
    distanceKm: ride.distance_km,
    durationMinutes: ride.duration_minutes,
    fareCents: ride.fare_cents,
    fixedFeeCents: ride.fixed_fee_cents,
    totalCents: ride.total_cents,
    driverShareCents: ride.driver_share_cents,
    platformShareCents: ride.platform_share_cents,
    paymentMethod: ride.payment_method,
    status: ride.status,
    paymentStatus: ride.payment_status,
    cancellationFeeCents: ride.cancel_fee_cents,
    createdAt: ride.created_at
  };
}

function publicQr(qr) {
  return { payload: qr.payload, image: `data:image/png;base64,${qr.encoded_image}`, expirationDate: qr.expiration_date };
}

function canAccessRide(user, ride) { return user.role === "admin" || ride.passenger_id === user.id || ride.driver_id === user.id; }
function normalizePoint(point) {
  const lat = Number(point?.lat), lng = Number(point?.lng);
  return isBarreirinhaPoint(lat, lng) ? { lat, lng } : null;
}
function isBarreirinhaPoint(lat, lng) { return Number.isFinite(lat) && Number.isFinite(lng) && lat > -2.86 && lat < -2.72 && lng > -57.16 && lng < -56.98; }
function normalizePhone(value) { return String(value || "").replace(/\D/g, "").slice(-11); }
function normalizeCpf(value) { return String(value || "").replace(/\D/g, "").slice(0, 11); }
function cleanName(value) { return cleanText(value, 100).replace(/\s+/g, " "); }
function cleanText(value, max = 200) { return String(value || "").trim().slice(0, max); }
function firstName(name) { return String(name || "Motorista").split(/\s+/)[0]; }
function numberEnv(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function round(value, decimals) { const factor = 10 ** decimals; return Math.round(value * factor) / factor; }
function todayManaus() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

function validateAccount({ name, phone, cpf, password }) {
  if (name.length < 3) return "Informe seu nome completo.";
  if (phone.length !== 11) return "Digite o DDD e os 9 números do celular.";
  if (!validCpf(cpf)) return "Digite um CPF válido.";
  if (password.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  return "";
}

function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let digit = 9; digit < 11; digit++) {
    let sum = 0;
    for (let i = 0; i < digit; i++) sum += Number(cpf[i]) * (digit + 1 - i);
    const check = (sum * 10) % 11 % 10;
    if (check !== Number(cpf[digit])) return false;
  }
  return true;
}

async function hashPassword(password, salt = randomToken(16)) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PASSWORD_ITERATIONS }, material, 256);
  return { salt, hash: bytesToBase64(new Uint8Array(bits)) };
}

async function verifyPassword(password, salt, expected) {
  const actual = await hashPassword(password, salt);
  return secureEqual(actual.hash, expected);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function secureEqual(a, b) {
  if (!a || !b) return false;
  const [left, right] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function randomToken(bytes) { return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function bytesToBase64(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}
function sessionCookie(token) { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`; }
function expiredSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
async function readJson(request) { try { return await request.json(); } catch { return null; } }
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

function haversineKm(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
}
