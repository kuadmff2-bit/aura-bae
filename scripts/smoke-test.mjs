import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";

class D1Statement {
  constructor(database, sql) {
    this.sql = sql;
    this.statement = database.prepare(sql);
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) || null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes || 0) } };
  }

  async executeForBatch() {
    return /^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) ? this.all() : this.run();
  }
}

class D1Memory {
  constructor() {
    this.database = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.executeForBatch());
    return results;
  }

  exec(sql) {
    this.database.exec(sql);
  }
}

const database = new D1Memory();
for (const migration of ["0001_initial.sql", "0002_accounts_profiles_recovery.sql", "0003_driver_wallet.sql", "0004_security_hardening.sql"]) {
  database.exec(fs.readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
}

const env = {
  DB: database,
  ASSETS: { fetch: () => new Response("not used") },
  ASAAS_ENVIRONMENT: "sandbox",
  ASAAS_API_KEY: "test-key",
  SUPPORT_PHONE: "5597991376123",
  PLATFORM_PERCENT: "10",
  PLATFORM_FIXED_FEE: "1.00",
  AUTOMATIC_PAYOUTS_ENABLED: "false"
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.includes("router.project-osrm.org")) {
    return Response.json({ routes: [{ distance: 1000, duration: 300, geometry: { coordinates: [[-57.07, -2.793], [-57.068, -2.79]] } }] });
  }
  if (url.includes("nominatim.openstreetmap.org/search")) {
    return Response.json([
      { place_id: 1, display_name: "Porto do Pucu, Barreirinha, Amazonas, Brasil", type: "port", lat: "-2.793", lon: "-57.07" },
      { place_id: 2, display_name: "Fora da cidade", type: "place", lat: "-3.10", lon: "-60.00" }
    ]);
  }
  if (url.includes("overpass-api.de/api/interpreter")) {
    return Response.json({ elements: [
      { type: "node", id: 10, lat: -2.7932, lon: -57.0698, tags: { name: "Mercadinho Teste", shop: "supermarket" } },
      { type: "way", id: 11, center: { lat: -2.794, lon: -57.071 }, tags: { name: "Lanchonete Teste", amenity: "fast_food" } }
    ] });
  }
  if (url.endsWith("/customers") && options.method === "POST") return Response.json({ id: "cus_smoke" });
  if (url.endsWith("/payments") && options.method === "POST") return Response.json({ id: "pay_wallet_smoke", status: "PENDING" });
  if (url.endsWith("/payments/pay_wallet_smoke/pixQrCode")) return Response.json({ payload: "PIX-SMOKE", encodedImage: "AA==", expirationDate: null });
  if (url.endsWith("/payments/pay_wallet_smoke")) return Response.json({ id: "pay_wallet_smoke", status: "RECEIVED" });
  return realFetch(input, options);
};

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function call(path, { method = "GET", body, cookie } = {}) {
  const response = await worker.fetch(new Request(`https://aura.test${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  }), env, { waitUntil() {} });
  const data = await response.json();
  return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}

const photo = "data:image/jpeg;base64,/9j/AA==";
const passenger = await call("/api/auth/register", {
  method: "POST",
  body: { name: "Passageiro Teste", phone: "92911111111", cpf: "11144477735", password: "Teste@1234", role: "passenger" }
});
assert(passenger.response.status === 201, `cadastro passageiro: ${passenger.data.error}`);
assert(passenger.data.user.cpf === undefined && passenger.data.user.cpfMasked === "***.***.***-35", "CPF completo foi exposto pela API");

const driver = await call("/api/auth/register", {
  method: "POST",
  body: {
    name: "Motorista Teste", phone: "92922222222", cpf: "52998224725", password: "Teste@1234", role: "driver",
    vehicleType: "mototaxi", vehicleModel: "Honda Pop teste", pixKeyType: "CPF", pixKey: "52998224725",
    profilePhoto: photo, vehiclePhoto: photo
  }
});
assert(driver.response.status === 201, `cadastro motorista: ${driver.data.error}`);
assert(driver.data.user.driverStatus === "pending" && driver.data.user.canDrive === false, "motorista deveria aguardar aprovação administrativa");

const wrongMode = await call("/api/auth/login", {
  method: "POST",
  body: { phone: "92911111111", password: "Teste@1234", mode: "driver" }
});
assert(wrongMode.response.status === 403, "passageiro sem perfil não deveria entrar como motorista");

const mapSearch = await call("/api/map/search?q=porto", { cookie: passenger.cookie });
assert(mapSearch.response.status === 200 && mapSearch.data.places?.length === 1, "pesquisa no mapa não respeitou Barreirinha");
const mapPois = await call("/api/map/pois", { cookie: passenger.cookie });
assert(mapPois.response.status === 200 && mapPois.data.places?.length === 2, "pontos comerciais não foram carregados");
assert(mapPois.data.places.some(place => place.category === "shopping"), "categoria de comércio inválida");

const pendingDriverLogin = await call("/api/auth/login", {
  method: "POST",
  body: { phone: "92922222222", password: "Teste@1234", mode: "driver" }
});
assert(pendingDriverLogin.response.status === 403, "motorista pendente não deveria entrar na área de trabalho");
await database.prepare("UPDATE users SET driver_status = 'approved' WHERE id = ?")
  .bind(driver.data.user.id).run();

const driverLogin = await call("/api/auth/login", {
  method: "POST",
  body: { phone: "92922222222", password: "Teste@1234", mode: "driver" }
});
assert(driverLogin.response.status === 200 && driverLogin.data.loginMode === "driver", "entrada de motorista falhou");

const online = await call("/api/driver/status", {
  method: "POST", cookie: driverLogin.cookie,
  body: { online: true, latitude: -2.79333, longitude: -57.07 }
});
assert(online.response.status === 200, `motorista online: ${online.data.error}`);

const rideCreated = await call("/api/rides", {
  method: "POST", cookie: passenger.cookie,
  body: {
    vehicleType: "mototaxi", paymentMethod: "CASH",
    origin: { lat: -2.79333, lng: -57.07 }, destination: { lat: -2.79, lng: -57.068 }
  }
});
assert(rideCreated.response.status === 201, `criar corrida: ${rideCreated.data.error}`);
const rideId = rideCreated.data.ride.id;

const available = await call("/api/rides/available", { cookie: driverLogin.cookie });
assert(available.data.rides?.[0]?.id === rideId, "corrida não apareceu para o motorista correto");
assert(available.data.rides[0].origin === undefined && available.data.rides[0].destination === undefined, "rota exata vazou antes de o motorista aceitar");

const blocked = await call(`/api/rides/${rideId}/accept`, { method: "POST", cookie: driverLogin.cookie });
assert(blocked.response.status === 402 && blocked.data.code === "INSUFFICIENT_WALLET_CREDIT", "corrida em dinheiro deveria exigir crédito");

await database.prepare(`INSERT INTO driver_wallet_entries
  (id, driver_id, kind, amount_cents, description) VALUES (?, ?, 'adjustment', 500, 'Teste')`)
  .bind("smoke-credit", driver.data.user.id).run();

const accepted = await call(`/api/rides/${rideId}/accept`, { method: "POST", cookie: driverLogin.cookie });
assert(accepted.response.status === 200, `aceitar corrida: ${accepted.data.error}`);

const passengerCurrent = await call("/api/rides/current?mode=passenger", { cookie: passenger.cookie });
assert(passengerCurrent.data.ride?.driver?.profilePhoto === photo, "foto do motorista não foi entregue ao passageiro");
assert(passengerCurrent.data.ride?.driver?.vehiclePhoto === photo, "foto do veículo não foi entregue ao passageiro");

assert((await call(`/api/rides/${rideId}/start`, { method: "POST", cookie: driverLogin.cookie })).response.status === 200, "início da corrida falhou");
assert((await call(`/api/rides/${rideId}/arrive`, { method: "POST", cookie: driverLogin.cookie })).response.status === 200, "chegada da corrida falhou");
const cash = await call(`/api/rides/${rideId}/cash-received`, { method: "POST", cookie: driverLogin.cookie });
assert(cash.response.status === 200 && cash.data.walletBalanceCents === 330, "desconto da carteira deveria ser R$ 1,70");

const topup = await call("/api/driver/wallet/topups", {
  method: "POST", cookie: driverLogin.cookie, body: { amountCents: 1000 }
});
assert(topup.response.status === 201 && topup.data.topup.payload === "PIX-SMOKE", `recarga: ${topup.data.error}`);
const wallet = await call("/api/driver/wallet", { cookie: driverLogin.cookie });
assert(wallet.response.status === 200 && wallet.data.balanceCents === 1330, "recarga Pix não foi confirmada na carteira");

const cancellable = await call("/api/rides", {
  method: "POST", cookie: passenger.cookie,
  body: {
    vehicleType: "mototaxi", paymentMethod: "PIX",
    origin: { lat: -2.79333, lng: -57.07 }, destination: { lat: -2.79, lng: -57.068 }
  }
});
assert(cancellable.response.status === 201, `criar corrida cancelável: ${cancellable.data.error}`);
const cancellableId = cancellable.data.ride.id;
assert((await call(`/api/rides/${cancellableId}/accept`, { method: "POST", cookie: driverLogin.cookie })).response.status === 200, "aceite da corrida cancelável falhou");
const cancelled = await call(`/api/rides/${cancellableId}/cancel`, { method: "POST", cookie: passenger.cookie });
assert(cancelled.response.status === 200 && cancelled.data.cancellationFeeCents === 0, "cancelamento do passageiro deveria ser gratuito");
const cancelledRow = await database.prepare("SELECT cancel_fee_cents, status FROM rides WHERE id = ?").bind(cancellableId).first();
assert(cancelledRow.status === "cancelled" && Number(cancelledRow.cancel_fee_cents) === 0, "banco registrou taxa de cancelamento indevida");

const deleted = await call("/api/profile/delete", {
  method: "POST", cookie: passenger.cookie, body: { password: "Teste@1234" }
});
assert(deleted.response.status === 200 && deleted.data.deleted, `exclusão de conta: ${deleted.data.error}`);
const deletedUser = await database.prepare("SELECT * FROM users WHERE id = ?").bind(passenger.data.user.id).first();
assert(deletedUser.deleted_at && deletedUser.profile_photo === null && deletedUser.cpf.startsWith("deleted-"), "dados pessoais não foram apagados");
const anonymizedRide = await database.prepare("SELECT origin_lat, anonymized_at FROM rides WHERE id = ?").bind(rideId).first();
assert(anonymizedRide.anonymized_at && Number(anonymizedRide.origin_lat) === -2.79, "localização antiga não foi anonimizada");

console.log("Smoke test OK: acessos, mapa, fotos, carteira, cancelamento, privacidade e exclusão segura.");
