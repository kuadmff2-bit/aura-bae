const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const digits = (value, limit = 20) => value.replace(/\D/g, "").slice(0, limit);
const brl = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const supportPhone = "5597991376123";
const platformFee = 1.5;

const vehicles = {
  mototaxi: { name: "Mototáxi", code: "MT", minimum: 7, extraKm: 2 },
  motocarro: { name: "Motocarro", code: "MC", minimum: 10, extraKm: 2.5 },
  taxi: { name: "Carro", code: "CR", minimum: 12, extraKm: 3 }
};

let liveDrivers = [];

let currentUser = null;
let authMode = "login";
let registerRole = "passenger";
let selectedVehicle = "motocarro";
let passengerStep = "idle";
let passengerTimer;
let driverOnline = false;
let driverStep = "waiting";
let driverTimer;
let cityMap = null;
let originPoint = null;
let destinationPoint = null;
let pickMode = "origin";
let originMarker = null;
let destinationMarker = null;
let routeLine = null;
let routeDistance = null;
let routeDuration = null;
let routeController = null;
let driverMarkers = [];
let assignedDriver = "";
let activeRide = null;
let ridePoller = null;
let driverPoller = null;
let locationPoller = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: options.body ? { "content-type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir a operação.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
function initials(name) { return name.split(" ").map(part => part[0]).slice(0, 2).join("").toUpperCase(); }
function phoneText(phone) { return `(${phone.slice(0,2)}) ${phone.slice(2,7)}-${phone.slice(7)}`; }
function pointText(point) { return point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "Toque no mapa para marcar"; }

function distanceBetween(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat), dLng = toRadians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(value));
}

function driversByProximity() {
  const reference = originPoint || { lat: -2.79333, lng: -57.07 };
  return liveDrivers.map(driver => ({ ...driver, lat: driver.latitude, lng: driver.longitude, distanceKm: driver.distanceKm ?? distanceBetween(reference, { lat: driver.latitude, lng: driver.longitude }) })).sort((a, b) => a.distanceKm - b.distanceKm);
}

function driverEta(distanceKm) { return Math.max(2, Math.ceil(distanceKm * 4)); }

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("aura-theme", theme);
  $$('[data-theme-toggle]').forEach(button => button.innerHTML = theme === "light" ? "☾ <span>Escuro</span>" : "☀ <span>Claro</span>");
}

$$('[data-theme-toggle]').forEach(button => button.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light")));
applyTheme(localStorage.getItem("aura-theme") || "dark");

$("#toggle-password").addEventListener("click", () => {
  const input = $("#auth-password");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  $("#toggle-password").textContent = visible ? "Mostrar" : "Ocultar";
  $("#toggle-password").setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
  $("#toggle-password").setAttribute("aria-pressed", String(!visible));
});

function setAuthMode(mode) {
  authMode = mode;
  $$('[data-auth-mode]').forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  $("#register-fields").classList.toggle("hidden", mode !== "register");
  $("#driver-register-fields").classList.toggle("hidden", mode !== "register" || registerRole !== "driver");
  $("#auth-kicker").textContent = mode === "login" ? "Bem-vindo de volta" : "Cadastro rápido";
  $("#auth-heading").textContent = mode === "login" ? "Entre na Aura Bae" : "Como você usará o aplicativo?";
  $("#auth-submit").textContent = mode === "login" ? "Entrar no sistema" : registerRole === "driver" ? "Enviar cadastro" : "Criar minha conta";
  $("#auth-error").classList.add("hidden");
}

$$('[data-auth-mode]').forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
$$('[data-register-role]').forEach(button => button.addEventListener("click", () => {
  registerRole = button.dataset.registerRole;
  $$('[data-register-role]').forEach(item => item.classList.toggle("active", item.dataset.registerRole === registerRole));
  setAuthMode("register");
}));

$("#auth-ddd").addEventListener("input", event => event.target.value = digits(event.target.value, 2));
$("#auth-number").addEventListener("input", event => event.target.value = digits(event.target.value, 9));
$("#auth-cpf").addEventListener("input", event => {
  const value = digits(event.target.value, 11);
  event.target.value = value.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
});

function showAuthError(message) { $("#auth-error").textContent = message; $("#auth-error").classList.remove("hidden"); }

$("#auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const phone = digits($("#auth-ddd").value, 2) + digits($("#auth-number").value, 9);
  const password = $("#auth-password").value;
  if (phone.length !== 11) return showAuthError("Digite o DDD e os 9 números do celular.");
  if (password.length < 8) return showAuthError("A senha precisa ter pelo menos 8 caracteres.");
  $("#auth-submit").disabled = true;
  const name = $("#auth-name").value.trim();
  try {
    const result = authMode === "login"
      ? await api("/api/auth/login", { method: "POST", body: { phone, password } })
      : await api("/api/auth/register", {
          method: "POST",
          body: {
            name,
            phone,
            cpf: digits($("#auth-cpf").value, 11),
            password,
            role: registerRole,
            vehicleType: registerRole === "driver" ? $("#auth-vehicle").value : undefined,
            vehicleModel: registerRole === "driver" ? $("#auth-vehicle-id").value.trim() : undefined,
            pixKeyType: registerRole === "driver" ? $("#auth-pix-type").value : undefined,
            pixKey: registerRole === "driver" ? $("#auth-pix-key").value.trim() : undefined
          }
        });
    enterApp(result.user);
  } catch (error) {
    showAuthError(error.message);
  } finally {
    $("#auth-submit").disabled = false;
  }
});

$("#setup-cpf").addEventListener("input", event => {
  const value = digits(event.target.value, 11);
  event.target.value = value.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
});

$("#setup-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("#setup-error").classList.add("hidden");
  try {
    const result = await api("/api/setup/admin", {
      method: "POST",
      body: {
        setupToken: $("#setup-token").value,
        name: $("#setup-name").value,
        phone: digits($("#setup-phone").value, 11),
        cpf: digits($("#setup-cpf").value, 11),
        password: $("#setup-password").value
      }
    });
    $("#setup-card").classList.add("hidden");
    $("#auth-card").classList.remove("hidden");
    enterApp(result.user);
  } catch (error) {
    $("#setup-error").textContent = error.message;
    $("#setup-error").classList.remove("hidden");
  }
});

function enterApp(user) {
  currentUser = user;
  currentUser.vehicle = user.vehicleType;
  currentUser.vehicleId = user.vehicleModel;
  currentUser.driverStatus = user.status;
  $("#auth-page").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#user-badge").textContent = initials(user.name);
  renderNav();
  showView(user.role === "admin" ? "admin" : user.role === "driver" ? "driver" : "passenger");
  if (user.role === "passenger") { $("#passenger-greeting").textContent = `Olá, ${user.name.split(" ")[0]}`; initializeMap(); resumePassengerRide(); }
  if (user.role === "driver") { renderDriverProfile(); resumeDriverRide(); }
  if (user.role === "admin") renderAdmin();
  updateSupportLink();
}

function renderNav() {
  const links = currentUser.role === "passenger" ? [["passenger", "Corrida"], ["support", "Suporte"]] : currentUser.role === "driver" ? [["driver", "Trabalho"], ["support", "Suporte"]] : [["admin", "Visão geral"], ["support", "Suporte"]];
  $("#main-nav").innerHTML = links.map(([id, label]) => `<button data-view="${id}">${label}</button>`).join("");
  $$('#main-nav [data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));
}

function showView(id) {
  $$('.view').forEach(view => view.classList.toggle("active", view.id === id));
  $$('#main-nav [data-view]').forEach(button => button.classList.toggle("active", button.dataset.view === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (id === "passenger") setTimeout(() => cityMap?.invalidateSize(), 80);
  if (id === "admin") renderAdmin();
  if (id === "support") updateSupportLink();
}

$("#logout").addEventListener("click", async () => {
  clearInterval(ridePoller); clearInterval(driverPoller);
  clearInterval(locationPoller);
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  currentUser = null;
  $("#app-shell").classList.add("hidden"); $("#auth-page").classList.remove("hidden");
  $("#auth-password").value = ""; setAuthMode("login");
});

function initializeMap() {
  if (cityMap || !window.L) return setTimeout(() => cityMap?.invalidateSize(), 80);
  cityMap = L.map("city-map", { zoomControl: true }).setView([-2.79333, -57.07], 15);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" }).addTo(cityMap);
  L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: .9, attribution: "Ruas &copy; Esri" }).addTo(cityMap);
  L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: .95 }).addTo(cityMap);
  cityMap.on("click", event => {
    if (activeRide) {
      $("#map-message").textContent = "Finalize ou cancele a corrida atual antes de alterar a rota.";
      $("#map-message").classList.remove("hidden");
      return;
    }
    resetPassenger();
    if (pickMode === "origin") { originPoint = event.latlng; pickMode = "destination"; }
    else destinationPoint = event.latlng;
    renderRoute();
  });
  renderRoute();
}

function markerIcon(letter, kind) { return L.divIcon({ className: "aura-marker-wrap", html: `<span class="aura-marker ${kind}">${letter}</span>`, iconSize: [38,38], iconAnchor: [19,36] }); }
function driverMarkerIcon(driver) {
  const firstName = driver.name.split(" ")[0];
  return L.divIcon({ className: "driver-marker-wrap", html: `<span class="driver-map-marker"><b>${vehicles[selectedVehicle].code}</b><small>${firstName}</small></span>`, iconSize: [116,42], iconAnchor: [58,21] });
}

function renderProximity() {
  const info = vehicles[selectedVehicle], list = driversByProximity(), closest = list[0], panel = $("#nearby-driver");
  $("#map-chip").textContent = `${list.length} ${info.name.toLowerCase()} disponíveis`;
  panel.classList.toggle("ready", Boolean(originPoint && closest));
  panel.innerHTML = !originPoint
    ? `<span class="nearby-driver-icon">${info.code}</span><div><small>Sistema de proximidade</small><strong>Marque a saída para calcular</strong><p>Aparecerão somente motoristas realmente disponíveis.</p></div>`
    : closest
      ? `<span class="nearby-driver-icon">${info.code}</span><div><small>Sistema de proximidade</small><strong>${closest.name} está mais perto</strong><p>${list.length} ${info.name.toLowerCase()} disponíveis para receber a chamada</p></div><aside><b>${closest.distanceKm.toFixed(1).replace(".", ",")} km</b><small>aprox. ${driverEta(closest.distanceKm)} min</small></aside>`
      : `<span class="nearby-driver-icon">${info.code}</span><div><small>Sistema de proximidade</small><strong>Nenhum motorista online agora</strong><p>Você ainda pode criar a chamada e aguardar alguém ficar disponível.</p></div>`;
}

async function renderRoute() {
  if (!cityMap) return;
  routeController?.abort();
  [originMarker, destinationMarker, routeLine, ...driverMarkers].filter(Boolean).forEach(layer => layer.remove());
  originMarker = destinationMarker = routeLine = null;
  driverMarkers = [];
  routeDistance = routeDuration = null;
  $("#route-result").classList.add("hidden"); $("#map-message").classList.add("hidden");
  liveDrivers = [];
  if (originPoint && currentUser?.role === "passenger") {
    try {
      const result = await api(`/api/drivers/nearby?vehicle=${encodeURIComponent(selectedVehicle)}&lat=${originPoint.lat}&lng=${originPoint.lng}`);
      liveDrivers = (result.drivers || []).map(driver => ({ ...driver, lat: driver.latitude, lng: driver.longitude }));
    } catch {}
  }
  liveDrivers.forEach(driver => {
    const marker = L.marker([driver.lat, driver.lng], { icon: driverMarkerIcon(driver), zIndexOffset: 120 }).addTo(cityMap);
    marker.bindTooltip(`${driver.name} • ${vehicles[selectedVehicle].name}`, { direction: "top", offset: [0, -12] });
    driverMarkers.push(marker);
  });
  renderProximity();
  if (originPoint) originMarker = L.marker(originPoint, { icon: markerIcon("A", "origin") }).addTo(cityMap);
  if (destinationPoint) destinationMarker = L.marker(destinationPoint, { icon: markerIcon("B", "destination") }).addTo(cityMap);
  $("#origin-label").textContent = pointText(originPoint); $("#destination-label").textContent = pointText(destinationPoint);
  $("#swap").disabled = !(originPoint && destinationPoint); $("#clear-route").disabled = !(originPoint || destinationPoint);
  $("#pick-origin").classList.toggle("active", pickMode === "origin"); $("#pick-destination").classList.toggle("active", pickMode === "destination");
  $("#route-instruction").textContent = pickMode === "origin" ? "1. Toque no local de saída" : destinationPoint ? "Calculando rota pelas ruas…" : "2. Agora toque no destino";
  updatePrice();
  if (!originPoint || !destinationPoint) return;
  routeController = new AbortController();
  $("#map-message").textContent = "Calculando rota pelas ruas…"; $("#map-message").classList.remove("hidden");
  const url = `https://router.project-osrm.org/route/v1/driving/${originPoint.lng},${originPoint.lat};${destinationPoint.lng},${destinationPoint.lat}?overview=full&geometries=geojson`;
  try {
    const response = await fetch(url, { signal: routeController.signal });
    const data = await response.json();
    const route = data.routes?.[0];
    if (!response.ok || !route) throw new Error("route");
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const routeCasing = L.polyline(coordinates, { color: "#ffffff", weight: 10, opacity: .92 });
    routeLine = L.featureGroup([routeCasing, L.polyline(coordinates, { color: "#16c784", weight: 6, opacity: 1 })]).addTo(cityMap);
    routeDistance = route.distance / 1000; routeDuration = Math.max(1, Math.round(route.duration / 60));
    cityMap.fitBounds(routeLine.getBounds(), { padding: [45,45], maxZoom: 17 });
    $("#route-instruction").textContent = "Rota calculada pelas ruas";
    $("#route-result").innerHTML = `<span>✓ Rota viária encontrada</span><b>${routeDistance.toFixed(1).replace(".", ",")} km</b><b>aprox. ${routeDuration} min</b>`;
    $("#route-result").classList.remove("hidden"); $("#map-message").classList.add("hidden");
    updatePrice(); resetPassenger();
  } catch (error) {
    if (error.name === "AbortError") return;
    $("#map-message").textContent = "Não foi possível encontrar uma rota pelas ruas. Escolha pontos próximos das vias.";
    $("#route-instruction").textContent = "Escolha pontos conectados às ruas";
    updatePrice();
  }
}

$("#pick-origin").onclick = () => { pickMode = "origin"; renderRoute(); };
$("#pick-destination").onclick = () => { pickMode = "destination"; renderRoute(); };
$("#swap").onclick = () => { [originPoint, destinationPoint] = [destinationPoint, originPoint]; renderRoute(); resetPassenger(); };
$("#clear-route").onclick = () => { originPoint = destinationPoint = null; pickMode = "origin"; renderRoute(); resetPassenger(); };

function fareValue() { const info = vehicles[selectedVehicle]; return routeDistance === null ? info.minimum : Math.ceil((info.minimum + Math.max(0, routeDistance - 2) * info.extraKm) * 2) / 2; }
function updatePrice() {
  const info = vehicles[selectedVehicle], fare = fareValue();
  $("#fare").textContent = $("#fare-line").textContent = brl(fare); $("#total").textContent = brl(fare + platformFee);
  $("#driver-share").textContent = brl(fare * .9); $("#platform-share").textContent = brl(fare * .1);
  $("#fare-description").textContent = routeDistance === null ? `Mínimo para ${info.name.toLowerCase()}` : `${routeDistance.toFixed(1).replace(".", ",")} km pela rota viária`;
}

$$('[data-vehicle]').forEach(button => button.onclick = () => {
  selectedVehicle = button.dataset.vehicle; const info = vehicles[selectedVehicle];
  $$('[data-vehicle]').forEach(item => item.classList.toggle("active", item.dataset.vehicle === selectedVehicle));
  $("#transport-code").textContent = info.code; $("#transport-name").textContent = info.name; renderRoute(); updatePrice(); resetPassenger();
});

function setStatus(label, title, text) {
  const info = vehicles[selectedVehicle];
  $("#status-panel").classList.remove("hidden");
  $("#status-panel").innerHTML = `<span class="avatar">${info.code}</span><div><small>${label}</small><strong>${title}</strong><p>${text}</p></div>`;
}

function resetPassenger() {
  clearTimeout(passengerTimer); passengerStep = "idle"; assignedDriver = "";
  $("#status-panel").classList.add("hidden"); $("#cancel-button").classList.add("hidden"); $("#payment-panel").innerHTML = "";
  const ready = Boolean(routeDistance !== null), info = vehicles[selectedVehicle];
  $("#action-button").classList.remove("hidden"); $("#action-button").disabled = !ready;
  $("#action-button").textContent = ready ? `Pedir ${info.name.toLowerCase()}` : "Marque a rota no mapa";
}

$("#action-button").onclick = async () => {
  const info = vehicles[selectedVehicle];
  if (passengerStep === "idle") {
    $("#action-button").disabled = true;
    $("#action-button").textContent = "Criando corrida…";
    try {
      const result = await api("/api/rides", {
        method: "POST",
        body: {
          vehicleType: selectedVehicle,
          origin: { lat: originPoint.lat, lng: originPoint.lng },
          destination: { lat: destinationPoint.lat, lng: destinationPoint.lng },
          paymentMethod: $("#payment-method").value
        }
      });
      activeRide = result.ride;
      renderPassengerRide(activeRide);
      startPassengerPolling();
    } catch (error) {
      $("#map-message").textContent = error.message;
      $("#map-message").classList.remove("hidden");
      $("#action-button").disabled = false;
      $("#action-button").textContent = `Pedir ${info.name.toLowerCase()}`;
    }
  } else if (passengerStep === "done") { activeRide = null; setRideControlsLocked(false); $("#clear-route").click(); }
};

async function resumePassengerRide() {
  try {
    const result = await api("/api/rides/current");
    if (!result.ride) return;
    activeRide = result.ride;
    selectedVehicle = activeRide.vehicleType;
    originPoint = L.latLng(activeRide.origin.lat, activeRide.origin.lng);
    destinationPoint = L.latLng(activeRide.destination.lat, activeRide.destination.lng);
    await renderRoute();
    renderPassengerRide(activeRide);
    startPassengerPolling();
  } catch {}
}

function startPassengerPolling() {
  clearInterval(ridePoller);
  ridePoller = setInterval(async () => {
    if (!activeRide) return;
    try {
      const result = await api(activeRide.status === "payment_pending" ? `/api/rides/${activeRide.id}/payment` : "/api/rides/current");
      if (result.ride) {
        activeRide = result.ride;
        renderPassengerRide(activeRide, result.payment);
      }
    } catch {}
  }, 3000);
}

function applyServerPrice(ride) {
  const fare = ride.fareCents / 100;
  $("#fare").textContent = $("#fare-line").textContent = brl(fare);
  $("#total").textContent = brl(ride.totalCents / 100);
  $("#driver-share").textContent = brl(ride.driverShareCents / 100);
  $("#platform-share").textContent = brl(ride.platformShareCents / 100);
}

function renderPassengerRide(ride, payment = null) {
  setRideControlsLocked(true);
  applyServerPrice(ride);
  $("#action-button").disabled = true;
  $("#action-button").classList.remove("hidden");
  $("#cancel-button").classList.toggle("hidden", !["searching", "accepted", "in_progress"].includes(ride.status));
  if (ride.status === "searching") {
    passengerStep = "searching";
    $("#action-button").textContent = "Buscando motorista próximo…";
    setStatus("Procurando motorista", "Chamada enviada", "Os motoristas disponíveis desta categoria podem aceitar a corrida.");
  } else if (ride.status === "accepted") {
    passengerStep = "assigned";
    $("#action-button").textContent = "Motorista a caminho";
    setStatus("Motorista a caminho", "Corrida aceita", "Aguarde no ponto de saída. O pagamento ainda não foi solicitado.");
  } else if (ride.status === "in_progress") {
    passengerStep = "running";
    $("#action-button").textContent = "Corrida em andamento";
    setStatus("Corrida em andamento", "Seguindo para o destino", "O motorista solicitará o pagamento somente ao chegar.");
  } else if (["arrived", "payment_pending"].includes(ride.status)) {
    passengerStep = "arrived";
    $("#action-button").classList.add("hidden");
    setStatus("Chegada confirmada", "Pagamento no destino", ride.paymentMethod === "CASH" ? "Entregue o valor ao motorista." : "Pague o Pix abaixo. A confirmação será automática.");
    if (ride.paymentMethod === "CASH") {
      $("#payment-panel").innerHTML = `<div class="payment-pending"><span>R$</span><h3>Pagamento em dinheiro</h3><p>Entregue ${brl(ride.totalCents / 100)} ao motorista. Ele confirmará o recebimento.</p></div>`;
    } else if (payment) renderPixPayment(payment, ride);
  } else if (ride.status === "paid") {
    clearInterval(ridePoller);
    showRating();
  }
}

function setRideControlsLocked(locked) {
  $$('[data-vehicle], #pick-origin, #pick-destination, #swap, #clear-route, #payment-method').forEach(control => control.disabled = locked);
}

function renderPixPayment(payment, ride) {
  $("#payment-panel").innerHTML = `<div class="payment-pending"><span>PIX</span><h3>${brl(ride.totalCents / 100)}</h3><p>Escaneie o QR Code ou copie o código Pix.</p><img class="pix-qr" src="${payment.image}" alt="QR Code Pix"><textarea id="pix-code" readonly>${payment.payload}</textarea><button id="copy-pix" class="primary">Copiar código Pix</button><small>Aguardando a confirmação automática do Asaas…</small></div>`;
  $("#copy-pix").onclick = async () => {
    await navigator.clipboard.writeText(payment.payload);
    $("#copy-pix").textContent = "Código copiado!";
  };
}

function showRating() {
  passengerStep = "rating"; $("#action-button").classList.add("hidden");
  $("#payment-panel").innerHTML = `<div class="rating-box"><span>Avalie seu motorista</span><strong>Como foi a corrida?</strong><div>${[1,2,3,4,5].map(n => `<button data-star="${n}">★</button>`).join("")}</div><button id="send-rating" class="primary" disabled>Enviar avaliação</button></div>`;
  let selectedRating = 0;
  $$('[data-star]').forEach(button => button.onclick = () => { selectedRating = Number(button.dataset.star); $$('[data-star]').forEach(star => star.classList.toggle("active", Number(star.dataset.star) <= selectedRating)); $("#send-rating").disabled = false; });
  $("#send-rating").onclick = async () => {
    try {
      await api(`/api/rides/${activeRide.id}/rate`, { method: "POST", body: { stars: selectedRating } });
      passengerStep = "done";
      $("#payment-panel").innerHTML = `<div class="success-box"><span>✓</span><h3>Corrida concluída</h3><p>Pagamento confirmado e avaliação enviada.</p></div>`;
      $("#action-button").classList.remove("hidden"); $("#action-button").disabled = false; $("#action-button").textContent = "Pedir outra corrida";
    } catch (error) { alert(error.message); }
  };
}

$("#cancel-button").onclick = async () => {
  if (!activeRide) return resetPassenger();
  if (!confirm("Deseja cancelar esta corrida? Pode haver taxa após o motorista aceitar.")) return;
  try {
    const result = await api(`/api/rides/${activeRide.id}/cancel`, { method: "POST" });
    clearInterval(ridePoller); activeRide = null; setRideControlsLocked(false); resetPassenger();
    if (result.cancellationFeeCents) alert(`Taxa de cancelamento: ${brl(result.cancellationFeeCents / 100)}.`);
  } catch (error) { alert(error.message); }
};

function renderDriverProfile() {
  const info = vehicles[currentUser.vehicle || "mototaxi"];
  $("#driver-greeting").textContent = `Olá, ${currentUser.name.split(" ")[0]}`;
  $("#driver-category-name").textContent = info.name; $("#driver-vehicle-id").textContent = currentUser.vehicleId || "Veículo não informado";
  if (currentUser.driverStatus !== "approved") {
    $("#online-toggle").classList.add("hidden"); $("#driver-description").textContent = "Seu cadastro foi recebido e será analisado pela administração.";
    $("#driver-panel").className = "empty pending-box"; $("#driver-panel").innerHTML = `<span>⌛</span><h2>Aguardando aprovação</h2><p>Assim que o administrador aprovar seu cadastro, o botão para ficar disponível será liberado.</p><a class="primary link-button fit" target="_blank" href="https://wa.me/${supportPhone}?text=${encodeURIComponent(`Olá, sou ${currentUser.name} e quero saber sobre meu cadastro na Aura Bae.`)}">Falar com o suporte</a>`;
  } else { $("#online-toggle").classList.remove("hidden"); renderDriverIdle(); }
}

function renderDriverIdle() {
  const info = vehicles[currentUser.vehicle || "mototaxi"];
  $("#driver-panel").className = "empty";
  $("#driver-panel").innerHTML = `<span>${info.code}</span><h2>${driverOnline ? "Aguardando chamadas" : "Você está indisponível"}</h2><p>${driverOnline ? `Somente corridas de ${info.name.toLowerCase()} aparecerão aqui.` : "Fique disponível para começar a receber chamadas próximas."}</p>`;
}

function showIncomingDriverRide(ride) {
  if (!driverOnline || !ride) return;
  const info = vehicles[currentUser.vehicle || "mototaxi"]; driverStep = "incoming";
  $("#driver-panel").className = "empty incoming";
  $("#driver-panel").innerHTML = `<span>${info.code}</span><small class="incoming-label">Nova chamada • ${info.name}</small><strong class="earn">${brl(ride.driverShareCents / 100)}</strong><div class="route-mini"><span><b>A</b> Passageiro a ${String(ride.pickupDistanceKm).replace(".", ",")} km</span><span><b>B</b> Corrida de ${String(ride.distanceKm).replace(".", ",")} km</span></div><div class="actions"><button id="reject" class="secondary">Ignorar</button><button id="accept" class="primary">Aceitar corrida</button></div>`;
  $("#reject").onclick = () => renderDriverIdle();
  $("#accept").onclick = async () => {
    try { const result = await api(`/api/rides/${ride.id}/accept`, { method: "POST" }); activeRide = result.ride; renderDriverRide(activeRide); }
    catch (error) { alert(error.message); renderDriverIdle(); }
  };
}

function showDriverStep(icon, title, text, button, action, disabled = false) {
  $("#driver-panel").className = "empty driver-flow";
  $("#driver-panel").innerHTML = `<span>${icon}</span><h2>${title}</h2><p>${text}</p><button id="driver-next" class="primary fit" ${disabled ? "disabled" : ""}>${button}</button>`;
  $("#driver-next").onclick = action;
}

function showDriverPayment() { showDriverStep("PIX", "Aguardando pagamento", "A corrida será liberada quando a confirmação do Pix chegar automaticamente.", "Aguardando confirmação do Pix", null, true); }

async function resumeDriverRide() {
  try {
    const result = await api("/api/rides/current");
    if (result.ride) {
      activeRide = result.ride; driverOnline = true;
      $("#online-toggle").classList.add("active"); $("#online-toggle").innerHTML = "<i></i> Disponível";
      renderDriverRide(activeRide); startDriverPolling();
    }
  } catch {}
}

function startDriverPolling() {
  clearInterval(driverPoller);
  clearInterval(locationPoller);
  locationPoller = setInterval(() => refreshDriverLocation(), 45000);
  driverPoller = setInterval(async () => {
    if (!driverOnline) return;
    try {
      const current = await api("/api/rides/current");
      if (current.ride) { activeRide = current.ride; renderDriverRide(activeRide); return; }
      activeRide = null;
      const available = await api("/api/rides/available");
      if (available.rides?.[0]) showIncomingDriverRide(available.rides[0]); else renderDriverIdle();
    } catch {}
  }, 3000);
}

async function refreshDriverLocation() {
  if (!driverOnline) return;
  try {
    const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve(position.coords), reject, { enableHighAccuracy: true, timeout: 12000 }));
    await api("/api/driver/status", { method: "POST", body: { online: true, latitude: coords.latitude, longitude: coords.longitude } });
  } catch {}
}

function renderDriverRide(ride) {
  if (ride.status === "accepted") {
    showDriverStep("A", "Vá buscar o passageiro", "Siga até o ponto de saída marcado no mapa.", "Passageiro embarcou", async () => {
      try { const result = await api(`/api/rides/${ride.id}/start`, { method: "POST" }); activeRide = result.ride; renderDriverRide(activeRide); }
      catch (error) { alert(error.message); }
    });
  } else if (ride.status === "in_progress") {
    showDriverStep("↗", "Corrida em andamento", "O pagamento ainda não foi solicitado.", "Cheguei ao destino", async () => {
      try { const result = await api(`/api/rides/${ride.id}/arrive`, { method: "POST" }); activeRide = result.ride; renderDriverRide(activeRide); }
      catch (error) { alert(error.message); }
    });
  } else if (ride.status === "arrived" && ride.paymentMethod === "CASH") {
    showDriverStep("R$", "Receba o pagamento", `Confirme somente após receber ${brl(ride.totalCents / 100)} em dinheiro.`, "Confirmar dinheiro recebido", async () => {
      try { const result = await api(`/api/rides/${ride.id}/cash-received`, { method: "POST" }); activeRide = result.ride; renderDriverRide(activeRide); }
      catch (error) { alert(error.message); }
    });
  } else if (["arrived", "payment_pending"].includes(ride.status)) showDriverPayment();
  else if (ride.status === "paid") {
    showDriverStep("✓", "Pagamento confirmado", "A corrida foi paga. O passageiro já pode avaliar.", "Aguardando avaliação", null, true);
  }
}

$("#online-toggle").onclick = async () => {
  const nextOnline = !driverOnline;
  $("#online-toggle").disabled = true;
  try {
    let coords = { latitude: -2.79333, longitude: -57.07 };
    if (nextOnline) {
      coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve(position.coords), reject, { enableHighAccuracy: true, timeout: 12000 }));
    }
    await api("/api/driver/status", { method: "POST", body: { online: nextOnline, latitude: coords.latitude, longitude: coords.longitude } });
    driverOnline = nextOnline;
    $("#online-toggle").classList.toggle("active", driverOnline); $("#online-toggle").innerHTML = `<i></i> ${driverOnline ? "Disponível" : "Indisponível"}`;
    if (driverOnline) startDriverPolling(); else { clearInterval(driverPoller); clearInterval(locationPoller); renderDriverIdle(); }
  } catch (error) { alert(error.message || "Não foi possível acessar sua localização."); }
  finally { $("#online-toggle").disabled = false; }
};

async function renderAdmin() {
  try {
    const [summary, result] = await Promise.all([api("/api/admin/summary"), api("/api/admin/drivers")]);
    const pending = result.drivers.filter(user => user.status === "pending");
    $("#approved-count").textContent = summary.approvedDrivers;
    $("#pending-count").textContent = summary.pendingDrivers; $("#ride-count").textContent = summary.rides;
    $("#pending-drivers").innerHTML = pending.length ? pending.map(user => `<div><b>${initials(user.name)}</b><p><strong>${user.name}</strong><span>${vehicles[user.vehicle_type].name} • ${phoneText(user.phone)}</span></p><button data-reject="${user.id}" class="danger-mini">Recusar</button><button data-approve="${user.id}" class="approve-mini">Aprovar</button></div>`).join("") : `<p class="muted">Nenhum cadastro aguardando análise.</p>`;
  } catch (error) { $("#pending-drivers").innerHTML = `<p class="form-error">${error.message}</p>`; }
  $$('[data-approve]').forEach(button => button.onclick = () => decideDriver(button.dataset.approve, "approved"));
  $$('[data-reject]').forEach(button => button.onclick = () => decideDriver(button.dataset.reject, "rejected"));
}

async function decideDriver(id, status) {
  try { await api(`/api/admin/drivers/${id}/${status === "approved" ? "approve" : "reject"}`, { method: "POST" }); renderAdmin(); }
  catch (error) { alert(error.message); }
}

function updateSupportLink() {
  if (!currentUser) return;
  const topic = $("#support-topic").value, message = $("#support-message").value;
  const text = `Olá, suporte Aura Bae. Meu nome é ${currentUser.name}, telefone ${phoneText(currentUser.phone)}. Assunto: ${topic}.${message ? ` Detalhes: ${message}` : ""}`;
  $("#support-link").href = `https://wa.me/${supportPhone}?text=${encodeURIComponent(text)}`;
}
$("#support-topic").onchange = updateSupportLink; $("#support-message").oninput = updateSupportLink;

(async () => {
  try {
    const setup = await api("/api/setup/status");
    if (setup.needsAdmin) {
      $("#auth-card").classList.add("hidden");
      $("#setup-card").classList.remove("hidden");
      return;
    }
    const result = await api("/api/auth/me");
    if (result.user) enterApp(result.user);
  } catch (error) {
    if (error.status && error.status !== 401) showAuthError(error.message);
  }
})();
