const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const digits = (value, limit = 20) => value.replace(/\D/g, "").slice(0, limit);
const brl = value => {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount) : "Calculando…";
};
const supportPhone = "5597991376123";
const platformFee = 1;
const themeStorageKey = "aura-theme-v2.5";
const mapHome = [-2.79333, -57.07];
const mapHomeZoom = 15;

const vehicles = {
  mototaxi: { name: "Mototáxi", code: "MT", minimum: 7, extraKm: 2 },
  motocarro: { name: "Motocarro", code: "MC", minimum: 10, extraKm: 2.5 },
  taxi: { name: "Carro", code: "CR", minimum: 12, extraKm: 3 }
};

let liveDrivers = [];

let currentUser = null;
let currentMode = "passenger";
let authMode = "login";
let loginRole = "passenger";
let registerRole = "passenger";
let selectedVehicle = "mototaxi";
let passengerStep = "idle";
let passengerTimer;
let driverOnline = false;
let driverStep = "waiting";
let driverTimer;
let cityMap = null;
let cityBaseLayer = null;
let adminBaseLayer = null;
let mapPickerSnapshot = null;
let mapSearchTimer = null;
let mapSearchController = null;
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
let assignedDriverMarker = null;
let driverApproachLine = null;
let driverTrackingController = null;
let driverTrackingKey = "";
let driverLocationRefreshRunning = false;
const driverProfileCache = new Map();
const driverProfileRequests = new Set();
let assignedDriver = "";
let activeRide = null;
let ridePoller = null;
let driverPoller = null;
let locationPoller = null;
let adminMap = null;
let adminDriverLayer = null;
let adminRideLayer = null;
let adminRouteLayer = null;
let adminPoller = null;
let adminMapHasFitted = false;
let adminRefreshRunning = false;
const adminRouteCache = new Map();
let walletPoller = null;
let currentWalletBalanceCents = 0;

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
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function phoneText(phone) { return `(${phone.slice(0,2)}) ${phone.slice(2,7)}-${phone.slice(7)}`; }
function pointText(point) { return point ? point.label || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "Toque no mapa para marcar"; }
function shortPlaceName(name) {
  const parts = String(name || "").split(",").map(part => part.trim()).filter(Boolean);
  return parts.slice(0, 2).join(", ") || "Local marcado";
}
function cpfText(cpf) { const value = digits(cpf || "", 11); return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"); }
function setMessage(element, message, success = false) { element.textContent = message; element.classList.remove("hidden"); element.classList.toggle("success-message", success); }

async function imageData(file) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Escolha uma foto JPG, PNG ou WebP.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const data = canvas.toDataURL("image/jpeg", .76);
  if (data.length > 520000) throw new Error("A foto ficou muito grande. Escolha uma imagem mais leve.");
  return data;
}

const croppedPhotoData = new Map();
let photoCropState = null;

function photoKind(input) {
  return input.id.includes("vehicle") ? "vehicle" : "portrait";
}

function photoPickerText(input) {
  if (input.id.includes("vehicle")) return { title: "Foto do veículo", action: "Adicionar veículo" };
  if (input.id === "profile-photo") return { title: "Foto do perfil", action: "Adicionar foto" };
  return { title: "Sua foto", action: "Adicionar foto" };
}

function updatePhotoPicker(input, data, readyText = "Foto pronta para salvar") {
  const control = input.closest("label")?.querySelector(".photo-picker-control");
  if (!control) return;
  const thumb = control.querySelector(".photo-picker-thumb");
  const status = control.querySelector(".photo-picker-status");
  const action = control.querySelector(".photo-picker-action");
  if (data) {
    thumb.src = data;
    thumb.classList.remove("hidden");
    control.querySelector(".photo-picker-icon").classList.add("hidden");
    status.textContent = readyText;
    action.textContent = "Trocar";
    control.classList.add("has-photo");
  } else {
    thumb.removeAttribute("src");
    thumb.classList.add("hidden");
    control.querySelector(".photo-picker-icon").classList.remove("hidden");
    status.textContent = "Toque para escolher e recortar";
    action.textContent = "Escolher";
    control.classList.remove("has-photo");
  }
}

function enhancePhotoInputs() {
  $$('input[type="file"][accept*="image"]').forEach(input => {
    if (input.dataset.photoEnhanced) return;
    input.dataset.photoEnhanced = "true";
    input.classList.add("photo-input");
    const label = input.closest("label");
    if (!label) return;
    const copy = photoPickerText(input);
    [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).forEach(node => node.remove());
    label.classList.add("photo-picker");
    const title = document.createElement("span");
    title.className = "photo-picker-title";
    title.textContent = copy.title;
    label.insertBefore(title, input);
    const control = document.createElement("span");
    control.className = "photo-picker-control";
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    control.innerHTML = `<span class="photo-picker-media"><span class="photo-picker-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8.3 5.2 9.4 3.5h5.2l1.1 1.7H19a3 3 0 0 1 3 3v8.8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8.2a3 3 0 0 1 3-3h3.3Zm3.7 3a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Zm0 2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z"/></svg></span><img class="photo-picker-thumb hidden" alt="Prévia da foto"></span><span class="photo-picker-copy"><strong>${copy.action}</strong><small class="photo-picker-status">Toque para escolher e recortar</small></span><span class="photo-picker-action">Escolher</span>`;
    label.appendChild(control);
    control.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) openPhotoCropper(input, file);
    });
  });
}

function cropBox() {
  return $("#photo-crop-stage").getBoundingClientRect();
}

function renderPhotoCrop() {
  if (!photoCropState) return;
  const box = cropBox();
  if (!box.width || !box.height) return;
  const { image } = photoCropState;
  photoCropState.baseScale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const scale = photoCropState.baseScale * photoCropState.zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const maxX = Math.max(0, (width - box.width) / 2);
  const maxY = Math.max(0, (height - box.height) / 2);
  photoCropState.offsetX = Math.max(-maxX, Math.min(maxX, photoCropState.offsetX));
  photoCropState.offsetY = Math.max(-maxY, Math.min(maxY, photoCropState.offsetY));
  photoCropState.rendered = {
    scale,
    left: box.width / 2 - width / 2 + photoCropState.offsetX,
    top: box.height / 2 - height / 2 + photoCropState.offsetY,
    width,
    height,
    boxWidth: box.width,
    boxHeight: box.height
  };
  const cropImage = $("#photo-crop-image");
  cropImage.style.width = `${width}px`;
  cropImage.style.height = `${height}px`;
  cropImage.style.left = `${photoCropState.rendered.left}px`;
  cropImage.style.top = `${photoCropState.rendered.top}px`;
}

function closePhotoCropper(cancelled = true) {
  if (!photoCropState) return;
  if (cancelled) photoCropState.input.value = "";
  URL.revokeObjectURL(photoCropState.url);
  photoCropState = null;
  $("#photo-crop-modal").classList.add("hidden");
  document.body.classList.remove("photo-crop-open");
}

function openPhotoCropper(input, file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    input.value = "";
    alert("Escolha uma foto JPG, PNG ou WebP.");
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const kind = photoKind(input);
    photoCropState = { input, image, url, kind, zoom: 1, offsetX: 0, offsetY: 0, dragging: null };
    const stage = $("#photo-crop-stage");
    stage.classList.toggle("vehicle", kind === "vehicle");
    stage.classList.toggle("portrait", kind !== "vehicle");
    $("#photo-crop-title").textContent = kind === "vehicle" ? "Recortar foto do veículo" : "Recortar sua foto";
    $("#photo-crop-hint").textContent = kind === "vehicle" ? "Arraste para deixar o veículo bem enquadrado." : "Arraste para posicionar o rosto dentro do quadro.";
    $("#photo-crop-zoom").value = "1";
    $("#photo-crop-image").src = url;
    $("#photo-crop-modal").classList.remove("hidden");
    document.body.classList.add("photo-crop-open");
    requestAnimationFrame(() => requestAnimationFrame(renderPhotoCrop));
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    input.value = "";
    alert("Não foi possível abrir essa foto. Escolha outra imagem.");
  };
  image.src = url;
}

function confirmPhotoCrop() {
  if (!photoCropState?.rendered) return;
  const { image, input, kind, rendered } = photoCropState;
  const outputWidth = kind === "vehicle" ? 960 : 720;
  const outputHeight = kind === "vehicle" ? 600 : 720;
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const sourceX = Math.max(0, -rendered.left / rendered.scale);
  const sourceY = Math.max(0, -rendered.top / rendered.scale);
  const sourceWidth = Math.min(image.naturalWidth - sourceX, rendered.boxWidth / rendered.scale);
  const sourceHeight = Math.min(image.naturalHeight - sourceY, rendered.boxHeight / rendered.scale);
  canvas.getContext("2d").drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
  let data = "";
  for (const quality of [.84, .74, .64, .54, .44]) {
    data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= 520000) break;
  }
  if (data.length > 520000) {
    alert("A foto ficou muito grande. Tente aproximar menos ou escolha outra imagem.");
    return;
  }
  croppedPhotoData.set(input.id, data);
  updatePhotoPicker(input, data);
  if (input.id === "profile-photo") {
    $("#profile-photo-preview").src = data;
    $("#profile-photo-preview").classList.remove("hidden");
  }
  input.value = "";
  closePhotoCropper(false);
}

async function selectedPhotoData(id) {
  if (croppedPhotoData.has(id)) return croppedPhotoData.get(id);
  return imageData(document.getElementById(id)?.files?.[0]);
}

enhancePhotoInputs();

const photoCropStage = $("#photo-crop-stage");
photoCropStage.addEventListener("pointerdown", event => {
  if (!photoCropState) return;
  photoCropStage.setPointerCapture(event.pointerId);
  photoCropState.dragging = { x: event.clientX, y: event.clientY, offsetX: photoCropState.offsetX, offsetY: photoCropState.offsetY };
});
photoCropStage.addEventListener("pointermove", event => {
  if (!photoCropState?.dragging) return;
  photoCropState.offsetX = photoCropState.dragging.offsetX + event.clientX - photoCropState.dragging.x;
  photoCropState.offsetY = photoCropState.dragging.offsetY + event.clientY - photoCropState.dragging.y;
  renderPhotoCrop();
});
photoCropStage.addEventListener("pointerup", () => { if (photoCropState) photoCropState.dragging = null; });
photoCropStage.addEventListener("pointercancel", () => { if (photoCropState) photoCropState.dragging = null; });
$("#photo-crop-zoom").addEventListener("input", event => {
  if (!photoCropState) return;
  photoCropState.zoom = Number(event.target.value);
  renderPhotoCrop();
});
$("#photo-crop-confirm").onclick = confirmPhotoCrop;
$("#photo-crop-cancel").onclick = () => closePhotoCropper(true);
$("#photo-crop-close").onclick = () => closePhotoCropper(true);
$("#photo-crop-modal").addEventListener("click", event => { if (event.target.id === "photo-crop-modal") closePhotoCropper(true); });
window.addEventListener("resize", () => { if (photoCropState) renderPhotoCrop(); });
window.addEventListener("keydown", event => { if (event.key === "Escape" && photoCropState) closePhotoCropper(true); });

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
  localStorage.setItem(themeStorageKey, theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#020806" : "#eef4f0");
  $$('[data-theme-toggle]').forEach(button => button.innerHTML = theme === "light" ? "☾ <span>Escuro</span>" : "☀ <span>Claro</span>");
  updateMapBaseLayers();
}

$$('[data-theme-toggle]').forEach(button => button.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light")));
applyTheme(localStorage.getItem(themeStorageKey) || "dark");

$("#toggle-password").addEventListener("click", () => {
  const input = $("#auth-password");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  $("#toggle-password").textContent = visible ? "Mostrar" : "Ocultar";
  $("#toggle-password").setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
  $("#toggle-password").setAttribute("aria-pressed", String(!visible));
});

$$('[data-password-target]').forEach(button => button.addEventListener("click", () => {
  const input = document.getElementById(button.dataset.passwordTarget);
  if (!input) return;
  const willShow = input.type === "password";
  input.type = willShow ? "text" : "password";
  button.textContent = willShow ? "Ocultar" : "Mostrar";
  button.setAttribute("aria-label", `${willShow ? "Ocultar" : "Mostrar"} ${input.id === "setup-token" ? "token" : "senha"}`);
  button.setAttribute("aria-pressed", String(willShow));
}));

function setAuthMode(mode) {
  authMode = mode;
  $$('[data-auth-mode]').forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  $("#login-role-choice").classList.toggle("hidden", mode !== "login");
  $("#register-fields").classList.toggle("hidden", mode !== "register");
  $("#driver-register-fields").classList.toggle("hidden", mode !== "register" || registerRole !== "driver");
  $("#auth-kicker").textContent = mode === "login" ? "Bem-vindo de volta" : "Cadastro rápido";
  $("#auth-heading").textContent = mode === "login" ? (loginRole === "driver" ? "Entre para trabalhar" : "Entre na Aura Bae") : "Como você usará o aplicativo?";
  $("#auth-submit").textContent = mode === "login" ? (loginRole === "driver" ? "Entrar como motorista" : "Entrar como passageiro") : registerRole === "driver" ? "Criar conta e começar" : "Criar minha conta";
  $("#auth-error").classList.add("hidden");
}

$$('[data-auth-mode]').forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
$$('[data-login-role]').forEach(button => button.addEventListener("click", () => {
  loginRole = button.dataset.loginRole;
  $$('[data-login-role]').forEach(item => item.classList.toggle("active", item.dataset.loginRole === loginRole));
  $("#auth-heading").textContent = loginRole === "driver" ? "Entre para trabalhar" : "Entre na Aura Bae";
  $("#auth-submit").textContent = loginRole === "driver" ? "Entrar como motorista" : "Entrar como passageiro";
}));
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
    const profilePhoto = authMode === "register" && registerRole === "driver" ? await selectedPhotoData("auth-profile-photo") : undefined;
    const vehiclePhoto = authMode === "register" && registerRole === "driver" ? await selectedPhotoData("auth-vehicle-photo") : undefined;
    const result = authMode === "login"
      ? await api("/api/auth/login", { method: "POST", body: { phone, password, mode: loginRole } })
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
            pixKey: registerRole === "driver" ? $("#auth-pix-key").value.trim() : undefined,
            profilePhoto,
            vehiclePhoto
          }
        });
    enterApp(result.user, result.loginMode || (authMode === "login" ? loginRole : registerRole));
  } catch (error) {
    showAuthError(error.message);
    if (error.data?.field) document.getElementById(error.data.field)?.focus();
  } finally {
    $("#auth-submit").disabled = false;
  }
});

function showAuthCard(card) {
  ["auth-card", "recovery-card", "reset-card", "setup-card"].forEach(id => document.getElementById(id)?.classList.toggle("hidden", id !== card));
}

$("#forgot-password").onclick = () => showAuthCard("recovery-card");
$("#back-to-login").onclick = () => showAuthCard("auth-card");
$("#recovery-phone").oninput = event => event.target.value = digits(event.target.value, 11);
$("#recovery-cpf").oninput = event => {
  const value = digits(event.target.value, 11);
  event.target.value = value.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};
$("#recovery-form").onsubmit = async event => {
  event.preventDefault();
  const output = $("#recovery-message");
  output.classList.add("hidden");
  try {
    const result = await api("/api/auth/recovery/request", { method: "POST", body: { phone: digits($("#recovery-phone").value, 11), cpf: digits($("#recovery-cpf").value, 11) } });
    setMessage(output, result.message, true);
  } catch (error) { setMessage(output, error.message); }
};

$("#reset-form").onsubmit = async event => {
  event.preventDefault();
  const password = $("#reset-password").value;
  const output = $("#reset-error");
  output.classList.add("hidden");
  if (password !== $("#reset-password-confirm").value) return setMessage(output, "As duas senhas precisam ser iguais.");
  try {
    await api("/api/auth/recovery/complete", { method: "POST", body: { token: new URLSearchParams(location.search).get("reset"), password } });
    history.replaceState({}, "", location.pathname);
    showAuthCard("auth-card");
    showAuthError("Senha alterada. Agora entre com a nova senha.");
  } catch (error) { setMessage(output, error.message); }
};

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

function enterApp(user, requestedMode = null) {
  currentUser = user;
  currentUser.vehicle = user.vehicleType;
  currentUser.vehicleId = user.vehicleModel;
  currentUser.driverStatus = user.driverStatus;
  const savedMode = requestedMode || localStorage.getItem("aura-entry-mode") || "passenger";
  currentMode = user.role === "admin" ? "admin" : savedMode === "driver" && user.canDrive ? "driver" : "passenger";
  if (user.role !== "admin") localStorage.setItem("aura-entry-mode", currentMode);
  $("#auth-page").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  renderUserBadge();
  renderNav();
  showView(currentMode);
  if (user.role !== "admin" && currentMode === "passenger") {
    $("#passenger-greeting").textContent = `Olá, ${user.name.split(" ")[0]}`;
    initializeMap();
    resumePassengerRide();
    if (!user.tutorialSeen?.passenger) setTimeout(() => showTutorial("passenger"), 350);
  }
  if (user.canDrive) renderDriverProfile();
  renderProfile();
  updateSupportLink();
}

function renderUserBadge() {
  if (!currentUser) return;
  $("#user-badge").innerHTML = currentUser.profilePhoto
    ? `<img src="${escapeHtml(currentUser.profilePhoto)}" alt="Foto de ${escapeHtml(currentUser.name)}">`
    : escapeHtml(initials(currentUser.name));
}

function renderNav() {
  const links = currentUser.role === "admin"
    ? [["admin", "Visão geral"], ["profile", "Perfil"], ["support", "Suporte"]]
    : currentMode === "driver"
      ? [["driver", "Trabalho"], ["wallet", "Carteira"], ["profile", "Perfil"], ["support", "Suporte"]]
      : [["passenger", "Corrida"], ["profile", "Perfil"], ["support", "Suporte"]];
  $("#main-nav").innerHTML = links.map(([id, label]) => `<button data-view="${id}">${label}</button>`).join("");
  $$('#main-nav [data-view]').forEach(button => button.onclick = () => showView(button.dataset.view));
}

function showView(id) {
  const permitted = currentUser?.role === "admin" ? ["admin", "profile", "support"]
    : currentMode === "driver" ? ["driver", "wallet", "profile", "support"] : ["passenger", "profile", "support"];
  if (!permitted.includes(id)) id = permitted[0];
  $$('.view').forEach(view => view.classList.toggle("active", view.id === id));
  $$('#main-nav [data-view]').forEach(button => button.classList.toggle("active", button.dataset.view === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (id === "passenger") setTimeout(() => cityMap?.invalidateSize(), 80);
  if (id === "driver") {
    renderDriverProfile(); resumeDriverRide();
    if (!currentUser.tutorialSeen?.driver) setTimeout(() => showTutorial("driver"), 250);
  }
  if (id === "wallet") renderWallet();
  else if (walletPoller) { clearInterval(walletPoller); walletPoller = null; }
  if (id === "profile") renderProfile();
  if (id === "admin") startAdminMonitoring();
  else clearInterval(adminPoller);
  if (id === "support") updateSupportLink();
}

$("#user-badge").onclick = () => showView("profile");

$("#logout").addEventListener("click", async () => {
  clearInterval(ridePoller); clearInterval(driverPoller);
  clearInterval(locationPoller); clearInterval(adminPoller);
  clearInterval(walletPoller);
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  currentUser = null;
  localStorage.removeItem("aura-entry-mode");
  $("#app-shell").classList.add("hidden"); $("#auth-page").classList.remove("hidden");
  $("#auth-password").value = ""; setAuthMode("login");
});

function mapTileSpec() {
  const dark = document.documentElement.dataset.theme === "dark";
  return dark
    ? { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: "Ruas &copy; OpenStreetMap, mapa &copy; CARTO" }
    : { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: "Ruas &copy; OpenStreetMap, mapa &copy; CARTO" };
}

function updateMapBaseLayers() {
  const spec = mapTileSpec();
  if (cityMap) {
    cityBaseLayer?.remove();
    cityBaseLayer = L.tileLayer(spec.url, { maxZoom: 20, subdomains: "abcd", attribution: spec.attribution }).addTo(cityMap);
    cityBaseLayer.bringToBack();
  }
  if (adminMap) {
    adminBaseLayer?.remove();
    adminBaseLayer = L.tileLayer(spec.url, { maxZoom: 20, subdomains: "abcd", attribution: spec.attribution }).addTo(adminMap);
    adminBaseLayer.bringToBack();
  }
}

function initializeMap() {
  if (cityMap || !window.L) return setTimeout(() => cityMap?.invalidateSize(), 80);
  cityMap = L.map("city-map", { zoomControl: true }).setView(mapHome, mapHomeZoom);
  updateMapBaseLayers();
  cityMap.on("click", event => {
    if (activeRide) {
      $("#map-message").textContent = "Finalize ou cancele a corrida atual antes de alterar a rota.";
      $("#map-message").classList.remove("hidden");
      return;
    }
    resetPassenger();
    if (pickMode === "origin") { originPoint = event.latlng; pickMode = "destination"; reversePointLabel("origin", originPoint); }
    else { destinationPoint = event.latlng; reversePointLabel("destination", destinationPoint); }
    renderRoute();
  });
  renderRoute();
}

function cloneMapPoint(point) {
  if (!point) return null;
  const clone = L.latLng(point.lat, point.lng);
  if (point.label) clone.label = point.label;
  return clone;
}

async function reversePointLabel(kind, point) {
  const expected = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
  try {
    const result = await api(`/api/map/reverse?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
    const current = kind === "origin" ? originPoint : destinationPoint;
    if (!current || `${current.lat.toFixed(6)},${current.lng.toFixed(6)}` !== expected || !result.name) return;
    current.label = shortPlaceName(result.name);
    $(`#${kind}-label`).textContent = pointText(current);
    $(`#${kind}-search`).value = current.label;
  } catch {}
}

function openMapPicker() {
  if (activeRide) return;
  mapPickerSnapshot = { origin: cloneMapPoint(originPoint), destination: cloneMapPoint(destinationPoint), pickMode };
  $("#origin-search").value = originPoint?.label || "";
  $("#destination-search").value = destinationPoint?.label || "";
  $("#city-map-shell").classList.add("expanded");
  document.body.classList.add("map-picker-open");
  setTimeout(() => {
    cityMap?.invalidateSize();
    if (originPoint && destinationPoint && routeLine) cityMap.fitBounds(routeLine.getBounds(), { padding: [80, 80], maxZoom: 17 });
  }, 100);
}

function closeMapPicker(save = true) {
  if (!save && mapPickerSnapshot) {
    originPoint = cloneMapPoint(mapPickerSnapshot.origin);
    destinationPoint = cloneMapPoint(mapPickerSnapshot.destination);
    pickMode = mapPickerSnapshot.pickMode;
    renderRoute();
  }
  mapPickerSnapshot = null;
  mapSearchController?.abort();
  $$(".map-search-results").forEach(list => list.classList.add("hidden"));
  $("#city-map-shell").classList.remove("expanded");
  document.body.classList.remove("map-picker-open");
  setTimeout(() => cityMap?.invalidateSize(), 80);
}

async function searchMap(kind, query) {
  const results = $(`#${kind}-search-results`);
  mapSearchController?.abort();
  if (query.trim().length < 3) {
    results.classList.add("hidden");
    results.innerHTML = "";
    return;
  }
  mapSearchController = new AbortController();
  results.innerHTML = `<p>Pesquisando em Barreirinha…</p>`;
  results.classList.remove("hidden");
  try {
    const response = await fetch(`/api/map/search?q=${encodeURIComponent(query.trim())}`, { credentials: "same-origin", signal: mapSearchController.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível pesquisar agora.");
    const places = data.places || [];
    results.innerHTML = places.length ? places.map((place, index) => `<button type="button" data-place-index="${index}"><strong>${escapeHtml(place.name.split(",")[0])}</strong><small>${escapeHtml(place.name)}</small></button>`).join("") : `<p>Nenhum resultado exato. Marque o ponto diretamente no mapa.</p>`;
    $$(`#${kind}-search-results [data-place-index]`).forEach(button => button.onclick = () => {
      const place = places[Number(button.dataset.placeIndex)];
      const point = L.latLng(place.lat, place.lng);
      point.label = shortPlaceName(place.name);
      if (kind === "origin") { originPoint = point; pickMode = "destination"; }
      else { destinationPoint = point; pickMode = "destination"; }
      $(`#${kind}-search`).value = point.label;
      results.classList.add("hidden");
      renderRoute();
      cityMap.setView(point, 17);
      resetPassenger();
    });
  } catch (error) {
    if (error.name !== "AbortError") results.innerHTML = `<p>${escapeHtml(error.message)} Marque no mapa se preferir.</p>`;
  }
}

function bindMapSearch(kind) {
  $(`#${kind}-search`).addEventListener("input", event => {
    clearTimeout(mapSearchTimer);
    mapSearchTimer = setTimeout(() => searchMap(kind, event.target.value), 650);
  });
  $(`#${kind}-search`).addEventListener("focus", () => { pickMode = kind; renderRoute(); });
}

bindMapSearch("origin");
bindMapSearch("destination");
$("#open-map-picker").onclick = openMapPicker;
$("#close-map-picker").onclick = () => closeMapPicker(false);
$("#cancel-map-picker").onclick = () => closeMapPicker(false);
$("#confirm-map-picker").onclick = () => {
  if (!originPoint || !destinationPoint) {
    $("#map-message").textContent = "Escolha a saída e o destino antes de confirmar.";
    $("#map-message").classList.remove("hidden");
    return;
  }
  closeMapPicker(true);
};

function markerIcon(letter, kind) { return L.divIcon({ className: "aura-marker-wrap", html: `<span class="aura-marker ${kind}">${letter}</span>`, iconSize: [38,38], iconAnchor: [19,36] }); }
function driverMarkerIcon(driver) {
  const firstName = driver.name.split(" ")[0];
  return L.divIcon({ className: "driver-marker-wrap", html: `<span class="driver-map-marker"><b>${vehicles[selectedVehicle].code}</b><small>${firstName}</small></span>`, iconSize: [116,42], iconAnchor: [58,21] });
}

function assignedDriverIcon(driver) {
  driver = { ...driver, ...(driverProfileCache.get(driver.id) || {}) };
  const info = vehicles[driver.vehicleType] || vehicles[selectedVehicle];
  const portrait = driver.profilePhoto
    ? `<img src="${escapeHtml(driver.profilePhoto)}" alt="">`
    : `<b>${escapeHtml(initials(driver.name))}</b>`;
  return L.divIcon({
    className: "assigned-driver-wrap",
    html: `<span class="assigned-driver-marker"><i>${portrait}</i><small>${escapeHtml(driver.name.split(" ")[0])}</small><em>A caminho</em></span>`,
    iconSize: [126, 48],
    iconAnchor: [63, 24]
  });
}

function clearDriverTracking() {
  driverTrackingController?.abort();
  driverTrackingController = null;
  driverTrackingKey = "";
  assignedDriverMarker?.remove();
  driverApproachLine?.remove();
  assignedDriverMarker = driverApproachLine = null;
}

function renderAssignedDriver(driver, status) {
  const card = $("#assigned-driver-card");
  if (!driver) {
    card.classList.add("hidden");
    card.innerHTML = "";
    return;
  }
  driver = { ...driver, ...(driverProfileCache.get(driver.id) || {}) };
  ensureAssignedDriverProfile(activeRide);
  const info = vehicles[driver.vehicleType] || vehicles[selectedVehicle];
  const driverPhoto = driver.profilePhoto
    ? `<img src="${escapeHtml(driver.profilePhoto)}" alt="Foto de ${escapeHtml(driver.name)}">`
    : `<span>${escapeHtml(initials(driver.name))}</span>`;
  const vehiclePhoto = driver.vehiclePhoto
    ? `<img src="${escapeHtml(driver.vehiclePhoto)}" alt="Foto do veículo de ${escapeHtml(driver.name)}">`
    : `<span>${escapeHtml(info.code)}</span>`;
  const statusText = status === "accepted" ? "Está indo buscar você" : status === "in_progress" ? "Corrida em andamento" : "Chegada confirmada";
  card.innerHTML = `<div class="assigned-driver-heading"><div><small>Seu motorista</small><h2>${escapeHtml(driver.name)}</h2><p>${escapeHtml(statusText)}</p></div><b>${escapeHtml(info.name)}</b></div><div class="assigned-photo-grid"><figure><div>${driverPhoto}</div><figcaption><strong>Motorista</strong><span>${escapeHtml(driver.name)}</span></figcaption></figure><figure><div>${vehiclePhoto}</div><figcaption><strong>Veículo</strong><span>${escapeHtml(driver.vehicleModel)}</span></figcaption></figure></div>`;
  card.classList.remove("hidden");
}

async function ensureAssignedDriverProfile(ride) {
  const id = ride?.driver?.id;
  if (!id || driverProfileCache.has(id) || driverProfileRequests.has(id)) return;
  driverProfileRequests.add(id);
  try {
    const result = await api(`/api/rides/${encodeURIComponent(ride.id)}/driver`);
    if (!result.driver) return;
    driverProfileCache.set(id, result.driver);
    if (activeRide?.id === ride.id && activeRide.driver?.id === id) {
      activeRide.driver = { ...activeRide.driver, ...result.driver };
      renderAssignedDriver(activeRide.driver, activeRide.status);
      if (assignedDriverMarker) assignedDriverMarker.setIcon(assignedDriverIcon(activeRide.driver));
    }
  } catch {} finally {
    driverProfileRequests.delete(id);
  }
}

async function updateDriverTracking(ride) {
  if (!cityMap || !ride?.driver?.location || !["accepted", "in_progress"].includes(ride.status)) {
    if (ride?.driver?.location && assignedDriverMarker) assignedDriverMarker.setLatLng(ride.driver.location);
    if (!["accepted", "in_progress"].includes(ride?.status)) {
      driverApproachLine?.remove();
      driverApproachLine = null;
    }
    return;
  }
  const driver = { ...ride.driver, ...(driverProfileCache.get(ride.driver.id) || {}) };
  const location = driver.location;
  const target = ride.status === "accepted" ? ride.origin : ride.destination;
  driverMarkers.forEach(marker => marker.remove());
  driverMarkers = [];
  if (!assignedDriverMarker) assignedDriverMarker = L.marker([location.lat, location.lng], { icon: assignedDriverIcon(driver), zIndexOffset: 450 }).addTo(cityMap);
  else assignedDriverMarker.setLatLng([location.lat, location.lng]);
  const key = `${ride.status}:${location.lat.toFixed(5)}:${location.lng.toFixed(5)}:${target.lat.toFixed(5)}:${target.lng.toFixed(5)}`;
  if (key === driverTrackingKey) return;
  driverTrackingKey = key;
  driverTrackingController?.abort();
  driverTrackingController = new AbortController();
  const url = `https://router.project-osrm.org/route/v1/driving/${location.lng},${location.lat};${target.lng},${target.lat}?overview=full&geometries=geojson`;
  try {
    const response = await fetch(url, { signal: driverTrackingController.signal });
    const data = await response.json();
    const route = data.routes?.[0];
    if (!response.ok || !route) throw new Error("route");
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    driverApproachLine?.remove();
    driverApproachLine = L.featureGroup([
      L.polyline(coordinates, { color: "#ffffff", weight: 11, opacity: .9 }),
      L.polyline(coordinates, { color: "#28c890", weight: 6, opacity: 1 })
    ]).addTo(cityMap);
    const eta = Math.max(1, Math.round(route.duration / 60));
    const distance = route.distance / 1000;
    $("#map-chip").textContent = ride.status === "accepted" ? `${driver.name.split(" ")[0]} chega em ${eta} min` : `${eta} min até o destino`;
    $("#map-message").textContent = `${distance.toFixed(1).replace(".", ",")} km pelas ruas • localização atualizada`;
    $("#map-message").classList.remove("hidden");
    cityMap.fitBounds(driverApproachLine.getBounds(), { padding: [52, 52], maxZoom: 17 });
  } catch (error) {
    if (error.name !== "AbortError") $("#map-chip").textContent = `${driver.name.split(" ")[0]} está a caminho`;
  }
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
  if (originPoint && currentUser?.role !== "admin") {
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
  if (originPoint) {
    originMarker = L.marker(originPoint, { icon: markerIcon("A", "origin"), draggable: !activeRide }).addTo(cityMap);
    if (!activeRide) originMarker.on("dragend", event => {
      originPoint = event.target.getLatLng();
      reversePointLabel("origin", originPoint);
      renderRoute();
      resetPassenger();
    });
  }
  if (destinationPoint) {
    destinationMarker = L.marker(destinationPoint, { icon: markerIcon("B", "destination"), draggable: !activeRide }).addTo(cityMap);
    if (!activeRide) destinationMarker.on("dragend", event => {
      destinationPoint = event.target.getLatLng();
      reversePointLabel("destination", destinationPoint);
      renderRoute();
      resetPassenger();
    });
  }
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

function clearRouteSelection({ resetMap = false, closePicker = false } = {}) {
  routeController?.abort();
  mapSearchController?.abort();
  originPoint = null;
  destinationPoint = null;
  pickMode = "origin";
  mapPickerSnapshot = null;
  $("#origin-search").value = "";
  $("#destination-search").value = "";
  $$(".map-search-results").forEach(list => {
    list.innerHTML = "";
    list.classList.add("hidden");
  });
  if (closePicker) {
    $("#city-map-shell").classList.remove("expanded");
    document.body.classList.remove("map-picker-open");
  }
  void renderRoute();
  if (resetMap) setTimeout(() => {
    cityMap?.invalidateSize();
    cityMap?.setView(mapHome, mapHomeZoom);
  }, 90);
}

$("#clear-route").onclick = () => {
  clearRouteSelection();
  resetPassenger();
};

function fareValue() {
  const info = vehicles[selectedVehicle];
  const minimum = Number(info?.minimum), extraKm = Number(info?.extraKm), distance = Number(routeDistance);
  if (!Number.isFinite(minimum) || !Number.isFinite(extraKm)) return null;
  if (routeDistance === null) return minimum;
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const fare = Math.ceil((minimum + Math.max(0, distance - 2) * extraKm) * 2) / 2;
  return Number.isFinite(fare) ? fare : null;
}
function updatePrice() {
  const info = vehicles[selectedVehicle], fare = fareValue();
  const valid = Number.isFinite(fare);
  $("#fare").textContent = valid ? brl(fare + platformFee) : "Calculando…";
  $("#fare-line").textContent = valid ? brl(fare) : "Calculando…";
  $("#total").textContent = valid ? brl(fare + platformFee) : "Calculando…";
  const distance = Number(routeDistance);
  $("#fare-description").textContent = routeDistance === null ? `Mínimo para ${info.name.toLowerCase()}` : Number.isFinite(distance) ? `${distance.toFixed(1).replace(".", ",")} km pela rota viária` : "Aguardando uma rota válida";
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
  clearDriverTracking();
  $("#passenger").classList.remove("ride-active");
  $("#assigned-driver-card").classList.add("hidden");
  $("#assigned-driver-card").innerHTML = "";
  $("#status-panel").classList.add("hidden"); $("#cancel-button").classList.add("hidden"); $("#payment-panel").innerHTML = "";
  const ready = Number.isFinite(Number(routeDistance)) && Number(routeDistance) > 0 && Number.isFinite(fareValue()), info = vehicles[selectedVehicle];
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
  }
};

async function resumePassengerRide() {
  try {
    const result = await api("/api/rides/current?mode=passenger");
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
      const result = await api(`/api/rides/${activeRide.id}/payment`);
      if (result.ride) {
        activeRide = result.ride;
        renderPassengerRide(activeRide, result.payment);
      } else handleExpiredPassengerRide();
    } catch {}
  }, 3000);
}

function applyServerPrice(ride) {
  const fare = ride.fareCents / 100;
  $("#fare").textContent = brl(ride.totalCents / 100);
  $("#fare-line").textContent = brl(fare);
  $("#total").textContent = brl(ride.totalCents / 100);
}

function renderPassengerRide(ride, payment = null) {
  setRideControlsLocked(true);
  $("#passenger").classList.add("ride-active");
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
  } else if (["paid", "completed"].includes(ride.status)) {
    finishPassengerRide(ride);
    return;
  } else if (ride.status === "cancelled") return handleExpiredPassengerRide(ride);
  renderAssignedDriver(ride.driver, ride.status);
  updateDriverTracking(ride);
}

function handleExpiredPassengerRide(ride = null) {
  clearInterval(ridePoller);
  activeRide = null;
  setRideControlsLocked(false);
  resetPassenger();
  if (ride?.autoCancelled) {
    $("#map-message").textContent = "A corrida ficou 5 minutos sem atualização e foi cancelada automaticamente. Você pode pedir novamente.";
    $("#map-message").classList.remove("hidden");
  }
}

function setRideControlsLocked(locked) {
  $$('[data-vehicle], #pick-origin, #pick-destination, #swap, #clear-route, #open-map-picker, #payment-method').forEach(control => control.disabled = locked);
}

function renderPixPayment(payment, ride) {
  $("#payment-panel").innerHTML = `<div class="payment-pending"><span>PIX</span><h3>${brl(ride.totalCents / 100)}</h3><p>Escaneie o QR Code ou copie o código Pix.</p><img class="pix-qr" src="${payment.image}" alt="QR Code Pix"><textarea id="pix-code" readonly>${payment.payload}</textarea><button id="copy-pix" class="primary">Copiar código Pix</button><small>Aguardando a confirmação automática do Asaas…</small></div>`;
  $("#copy-pix").onclick = async () => {
    await navigator.clipboard.writeText(payment.payload);
    $("#copy-pix").textContent = "Código copiado!";
  };
}

function finishPassengerRide(ride) {
  const completedRideId = ride.id;
  clearInterval(ridePoller);
  activeRide = null;
  setRideControlsLocked(false);
  resetPassenger();
  clearRouteSelection({ resetMap: true, closePicker: true });
  showRating(completedRideId);
}

function showRating(completedRideId) {
  passengerStep = "idle";
  $("#action-button").classList.remove("hidden");
  $("#action-button").disabled = true;
  $("#action-button").textContent = "Marque uma nova rota";
  $("#payment-panel").innerHTML = `<div class="success-box"><span>✓</span><h3>Corrida concluída</h3><p>Pagamento confirmado. O mapa já está livre para a próxima corrida.</p></div><div class="rating-box"><span>Se quiser, avalie o motorista</span><strong>Como foi a corrida?</strong><div>${[1,2,3,4,5].map(n => `<button data-star="${n}">★</button>`).join("")}</div><button id="send-rating" class="secondary" disabled>Enviar avaliação</button></div>`;
  let selectedRating = 0;
  $$('[data-star]').forEach(button => button.onclick = () => { selectedRating = Number(button.dataset.star); $$('[data-star]').forEach(star => star.classList.toggle("active", Number(star.dataset.star) <= selectedRating)); $("#send-rating").disabled = false; });
  $("#send-rating").onclick = async () => {
    try {
      await api(`/api/rides/${completedRideId}/rate`, { method: "POST", body: { stars: selectedRating } });
      $(".rating-box").innerHTML = `<span>Obrigado!</span><strong>Avaliação enviada.</strong>`;
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
  if (!currentUser.canDrive) {
    $("#online-toggle").classList.add("hidden");
    const suspended = currentUser.driverStatus === "suspended";
    $("#driver-description").textContent = suspended ? "Seu perfil de motorista está suspenso." : "Ative seu perfil de motorista na área de perfil.";
    $("#driver-panel").className = "empty pending-box";
    $("#driver-panel").innerHTML = suspended ? `<span>!</span><h2>Perfil de motorista suspenso</h2><p>Você continua podendo usar a conta como passageiro. Fale com o suporte para revisar a suspensão.</p>` : `<span>+</span><h2>Ative o modo motorista</h2><p>Abra seu perfil, adicione as fotos e os dados do veículo. A ativação é automática.</p><button id="open-driver-profile" class="primary fit">Abrir meu perfil</button>`;
    $("#open-driver-profile")?.addEventListener("click", () => showView("profile"));
  } else { $("#online-toggle").classList.remove("hidden"); renderDriverIdle(); }
}

function renderDriverIdle() {
  const info = vehicles[currentUser.vehicle || "mototaxi"];
  $("#driver-panel").className = "empty";
  $("#driver-panel").innerHTML = `<span>${info.code}</span><h2>${driverOnline ? "Aguardando chamadas" : "Você está indisponível"}</h2><p>${driverOnline ? `Somente corridas de ${info.name.toLowerCase()} aparecerão aqui.` : "Fique disponível para começar a receber chamadas próximas."}</p>`;
}

function showIncomingDriverRide(ride, walletBalanceCents = currentWalletBalanceCents) {
  if (!driverOnline || !ride) return;
  const info = vehicles[currentUser.vehicle || "mototaxi"]; driverStep = "incoming";
  currentWalletBalanceCents = Number(walletBalanceCents || 0);
  const cash = ride.paymentMethod === "CASH";
  const required = Number(ride.cashChargeCents ?? (ride.platformShareCents + ride.fixedFeeCents));
  const enoughCredit = !cash || currentWalletBalanceCents >= required;
  const paymentInfo = cash
    ? `<div class="cash-credit-check ${enoughCredit ? "ready" : "low"}"><span>Dinheiro</span><div><small>Crédito que será descontado</small><strong>${brl(required / 100)}</strong></div><div><small>Seu saldo</small><strong>${brl(currentWalletBalanceCents / 100)}</strong></div></div>`
    : `<div class="cash-credit-check ready"><span>PIX</span><div><small>Pagamento</small><strong>Confirmado pelo app</strong></div></div>`;
  $("#driver-panel").className = "empty incoming";
  $("#driver-panel").innerHTML = `<span>${info.code}</span><small class="incoming-label">Nova chamada • ${info.name}</small><strong class="earn">${brl(ride.driverShareCents / 100)}</strong><small>Valor líquido do motorista</small><div class="route-mini"><span><b>A</b> Passageiro a ${String(ride.pickupDistanceKm).replace(".", ",")} km</span><span><b>B</b> Corrida de ${String(ride.distanceKm).replace(".", ",")} km</span></div>${paymentInfo}<div class="actions"><button id="reject" class="secondary">Ignorar</button><button id="accept" class="primary" ${enoughCredit ? "" : "disabled"}>${enoughCredit ? "Aceitar corrida" : "Crédito insuficiente"}</button></div>${enoughCredit ? "" : `<button id="open-wallet-from-ride" class="secondary">Adicionar crédito na carteira</button>`}`;
  $("#reject").onclick = () => renderDriverIdle();
  $("#open-wallet-from-ride")?.addEventListener("click", () => showView("wallet"));
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
    const result = await api("/api/rides/current?mode=driver");
    if (result.ride) {
      activeRide = result.ride; driverOnline = true;
      $("#online-toggle").classList.add("active"); $("#online-toggle").innerHTML = "<i></i> Disponível agora";
      renderDriverRide(activeRide); startDriverPolling();
    }
  } catch {}
}

function startDriverPolling() {
  clearInterval(driverPoller);
  clearInterval(locationPoller);
  refreshDriverLocation();
  locationPoller = setInterval(() => refreshDriverLocation(), 10000);
  driverPoller = setInterval(async () => {
    if (!driverOnline) return;
    try {
      const current = await api("/api/rides/current?mode=driver");
      if (current.ride) { activeRide = current.ride; renderDriverRide(activeRide); return; }
      activeRide = null;
      const available = await api("/api/rides/available");
      currentWalletBalanceCents = Number(available.walletBalanceCents || 0);
      if (available.rides?.[0]) showIncomingDriverRide(available.rides[0], currentWalletBalanceCents); else renderDriverIdle();
    } catch {}
  }, 3000);
}

async function refreshDriverLocation() {
  if (!driverOnline || driverLocationRefreshRunning) return;
  driverLocationRefreshRunning = true;
  try {
    const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve(position.coords), reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }));
    await api("/api/driver/status", { method: "POST", body: { online: true, latitude: coords.latitude, longitude: coords.longitude } });
  } catch {} finally { driverLocationRefreshRunning = false; }
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
  else if (["paid", "completed"].includes(ride.status)) {
    showDriverStep("✓", "Corrida finalizada", "Pagamento confirmado. Você já pode receber uma nova chamada.", "Finalizada", null, true);
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
    $("#online-toggle").classList.toggle("active", driverOnline); $("#online-toggle").innerHTML = `<i></i> ${driverOnline ? "Disponível agora" : "Ficar disponível"}`;
    if (driverOnline) startDriverPolling(); else { clearInterval(driverPoller); clearInterval(locationPoller); renderDriverIdle(); }
  } catch (error) { alert(error.message || "Não foi possível acessar sua localização."); }
  finally { $("#online-toggle").disabled = false; }
};

function walletStatusText(status) {
  if (["RECEIVED", "CONFIRMED"].includes(status)) return "Crédito confirmado";
  if (["REFUNDED", "DELETED"].includes(status)) return "Pagamento cancelado";
  return "Aguardando pagamento";
}

function renderWalletPayment(topup) {
  const container = $("#wallet-payment");
  if (!topup || ["RECEIVED", "CONFIRMED"].includes(topup.status)) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="wallet-pix"><span>PIX</span><h3>${brl(topup.amountCents / 100)}</h3><p>Escaneie o QR Code ou copie o código. O saldo entra automaticamente após a confirmação.</p><img src="${escapeHtml(topup.image)}" alt="QR Code para adicionar crédito"><textarea id="wallet-pix-code" readonly>${escapeHtml(topup.payload)}</textarea><button id="copy-wallet-pix" class="primary" type="button">Copiar código Pix</button><small>${escapeHtml(walletStatusText(topup.status))}</small></div>`;
  container.classList.remove("hidden");
  $("#copy-wallet-pix").onclick = async () => {
    try {
      await navigator.clipboard.writeText(topup.payload);
      $("#copy-wallet-pix").textContent = "Código copiado";
    } catch { $("#wallet-pix-code").select(); }
  };
}

async function renderWallet() {
  if (!currentUser?.canDrive || currentMode !== "driver") return;
  try {
    const result = await api("/api/driver/wallet");
    currentWalletBalanceCents = Number(result.balanceCents || 0);
    $("#wallet-balance").textContent = brl(currentWalletBalanceCents / 100);
    const entries = result.entries || [];
    $("#wallet-history").innerHTML = entries.length ? entries.map(entry => {
      const positive = Number(entry.amount_cents) >= 0;
      return `<div><span class="wallet-entry-icon ${positive ? "positive" : "negative"}">${positive ? "+" : "−"}</span><p><strong>${escapeHtml(entry.description)}</strong><small>${new Date(`${entry.created_at}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small></p><b class="${positive ? "positive" : "negative"}">${positive ? "+" : "−"}${brl(Math.abs(Number(entry.amount_cents)) / 100)}</b></div>`;
    }).join("") : `<p class="muted">Nenhuma movimentação ainda.</p>`;
    const pending = (result.topups || []).find(topup => !["RECEIVED", "CONFIRMED", "REFUNDED", "DELETED"].includes(topup.status));
    renderWalletPayment(pending);
    if (pending && !walletPoller) walletPoller = setInterval(renderWallet, 5000);
    if (!pending && walletPoller) { clearInterval(walletPoller); walletPoller = null; }
  } catch (error) {
    setMessage($("#wallet-error"), error.message);
  }
}

$$('[data-wallet-amount]').forEach(button => button.onclick = () => {
  $$('[data-wallet-amount]').forEach(item => item.classList.toggle("active", item === button));
  $("#wallet-amount").value = (Number(button.dataset.walletAmount) / 100).toFixed(2).replace(".", ",");
});

$("#wallet-amount").addEventListener("input", () => $$('[data-wallet-amount]').forEach(item => item.classList.remove("active")));
$("#wallet-topup-form").onsubmit = async event => {
  event.preventDefault();
  const output = $("#wallet-error");
  output.classList.add("hidden");
  const raw = $("#wallet-amount").value.trim().replace(/\./g, "").replace(",", ".");
  const amountCents = Math.round(Number(raw) * 100);
  const submit = event.submitter || event.target.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api("/api/driver/wallet/topups", { method: "POST", body: { amountCents } });
    renderWalletPayment(result.topup);
    if (!walletPoller) walletPoller = setInterval(renderWallet, 5000);
  } catch (error) { setMessage(output, error.message); }
  finally { submit.disabled = false; }
};

const operationStatusLabels = {
  searching: "Buscando motorista",
  accepted: "Motorista a caminho",
  in_progress: "Em andamento",
  arrived: "Chegou ao destino",
  payment_pending: "Aguardando pagamento",
  paid: "Pagamento confirmado",
  completed: "Finalizada"
};

function initializeAdminMap() {
  if (adminMap || !window.L || !$("#admin-operations-map")) return;
  adminMap = L.map("admin-operations-map", { zoomControl: true }).setView(mapHome, mapHomeZoom);
  updateMapBaseLayers();
  adminRouteLayer = L.layerGroup().addTo(adminMap);
  adminRideLayer = L.layerGroup().addTo(adminMap);
  adminDriverLayer = L.layerGroup().addTo(adminMap);
}

function adminDriverIcon(driver) {
  const vehicle = vehicles[driver.vehicle_type] || { code: "MO" };
  return L.divIcon({
    className: "admin-marker-wrap",
    html: `<span class="admin-driver-marker"><b>${vehicle.code}</b><small>${escapeHtml(driver.name.split(" ")[0])}</small></span>`,
    iconSize: [112, 40], iconAnchor: [56, 20]
  });
}

function adminPointIcon(letter, destination = false) {
  return L.divIcon({ className: "admin-marker-wrap", html: `<span class="admin-point-marker ${destination ? "destination" : ""}">${letter}</span>`, iconSize: [32, 32], iconAnchor: [16, 28] });
}

async function getAdminRoute(ride) {
  if (adminRouteCache.has(ride.id)) return adminRouteCache.get(ride.id);
  const fallback = [[ride.origin_lat, ride.origin_lng], [ride.destination_lat, ride.destination_lng]];
  const routePromise = fetch(`https://router.project-osrm.org/route/v1/driving/${ride.origin_lng},${ride.origin_lat};${ride.destination_lng},${ride.destination_lat}?overview=full&geometries=geojson`)
    .then(response => response.ok ? response.json() : null)
    .then(data => data?.routes?.[0]?.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) || fallback)
    .catch(() => fallback);
  adminRouteCache.set(ride.id, routePromise);
  return routePromise;
}

function renderActiveRideList(rides) {
  $("#active-rides-list").innerHTML = rides.length ? rides.map(ride => {
    const vehicle = vehicles[ride.vehicle_type] || { code: "?", name: "Transporte" };
    const driver = ride.driver_name ? escapeHtml(ride.driver_name.split(" ")[0]) : "Aguardando motorista";
    return `<button class="operation-ride" data-operation-ride="${ride.id}"><span class="operation-code">${vehicle.code}</span><span><small>${escapeHtml(operationStatusLabels[ride.status] || ride.status)}</small><strong>${escapeHtml(ride.passenger_name)}</strong><em>${vehicle.name} • ${driver}</em></span><b>${brl(ride.total_cents / 100)}</b></button>`;
  }).join("") : `<div class="operations-empty"><span>✓</span><strong>Nenhuma corrida ativa</strong><small>Novas solicitações aparecerão aqui.</small></div>`;
  $$('[data-operation-ride]').forEach(button => button.onclick = async () => {
    const ride = rides.find(item => item.id === button.dataset.operationRide);
    if (!ride || !adminMap) return;
    const route = await getAdminRoute(ride);
    adminMap.fitBounds(L.latLngBounds(route), { padding: [42, 42], maxZoom: 17 });
  });
}

async function renderAdminOperations(operations) {
  initializeAdminMap();
  const drivers = operations.onlineDrivers || [], rides = operations.activeRides || [];
  $("#online-count").textContent = drivers.length;
  $("#active-ride-count").textContent = rides.length;
  $("#operations-total").textContent = rides.length;
  $("#operations-updated").textContent = `Atualizado às ${new Date(operations.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  renderActiveRideList(rides);
  if (!adminMap) return;
  adminDriverLayer.clearLayers(); adminRideLayer.clearLayers(); adminRouteLayer.clearLayers();
  const bounds = [];
  drivers.forEach(driver => {
    const point = [driver.latitude, driver.longitude]; bounds.push(point);
    const vehicle = vehicles[driver.vehicle_type] || { name: "Motorista" };
    L.marker(point, { icon: adminDriverIcon(driver), zIndexOffset: 300 }).bindPopup(`<strong>${escapeHtml(driver.name)}</strong><br>${escapeHtml(vehicle.name)}${driver.vehicle_model ? ` • ${escapeHtml(driver.vehicle_model)}` : ""}<br><small>Online agora</small>`).addTo(adminDriverLayer);
  });
  await Promise.all(rides.slice(0, 20).map(async ride => {
    const origin = [ride.origin_lat, ride.origin_lng], destination = [ride.destination_lat, ride.destination_lng];
    bounds.push(origin, destination);
    const route = await getAdminRoute(ride);
    const activeColor = ride.status === "in_progress" ? "#21d091" : ride.status === "searching" ? "#f4bd4d" : "#62a9ff";
    L.polyline(route, { color: "#ffffff", weight: 9, opacity: .82 }).addTo(adminRouteLayer);
    L.polyline(route, { color: activeColor, weight: 5, opacity: 1 }).bindTooltip(`${escapeHtml(ride.passenger_name)} • ${escapeHtml(operationStatusLabels[ride.status] || ride.status)}`).addTo(adminRouteLayer);
    L.marker(origin, { icon: adminPointIcon("A") }).bindTooltip(`Saída • ${escapeHtml(ride.passenger_name)}`).addTo(adminRideLayer);
    L.marker(destination, { icon: adminPointIcon("B", true) }).bindTooltip(`Destino • ${escapeHtml(ride.passenger_name)}`).addTo(adminRideLayer);
  }));
  if (!adminMapHasFitted && bounds.length) {
    adminMap.fitBounds(L.latLngBounds(bounds), { padding: [45, 45], maxZoom: 16 });
    adminMapHasFitted = true;
  }
  setTimeout(() => adminMap.invalidateSize(), 80);
}

function startAdminMonitoring() {
  initializeAdminMap();
  clearInterval(adminPoller);
  renderAdmin();
  adminPoller = setInterval(renderAdmin, 10000);
  setTimeout(() => adminMap?.invalidateSize(), 100);
}

async function renderAdmin() {
  if (adminRefreshRunning) return;
  adminRefreshRunning = true;
  try {
    const [summary, result, operations, recovery] = await Promise.all([api("/api/admin/summary"), api("/api/admin/drivers"), api("/api/admin/operations"), api("/api/admin/password-resets")]);
    const drivers = result.drivers || [];
    $("#approved-count").textContent = summary.approvedDrivers;
    $("#pending-count").textContent = `${summary.approvedDrivers} ativo${summary.approvedDrivers === 1 ? "" : "s"}`;
    $("#ride-count").textContent = summary.rides;
    $("#pending-drivers").innerHTML = drivers.length ? drivers.map(user => {
      const vehicleName = vehicles[user.vehicle_type]?.name || "Veículo não informado";
      const active = user.driver_status === "approved";
      const avatar = user.profile_photo ? `<img src="${user.profile_photo}" alt="Foto de ${escapeHtml(user.name)}">` : escapeHtml(initials(user.name));
      return `<div><b class="admin-driver-photo">${avatar}</b><p><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(vehicleName)} • ${escapeHtml(phoneText(user.phone))}</span><small>${active ? "Motorista ativo" : user.driver_status === "suspended" ? "Suspenso" : "Inativo"}</small></p><button data-driver-action="${active ? "suspend" : "activate"}" data-driver-id="${user.id}" class="${active ? "danger-mini" : "approve-mini"}">${active ? "Suspender" : "Ativar"}</button></div>`;
    }).join("") : `<p class="muted">Nenhum motorista cadastrado.</p>`;
    const requests = recovery.requests || [];
    $("#recovery-count").textContent = `${requests.length} pedido${requests.length === 1 ? "" : "s"}`;
    $("#password-reset-list").innerHTML = requests.length ? requests.map(item => `<div><b>🔑</b><p><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(phoneText(item.phone))} • CPF final ${escapeHtml(String(item.cpf).slice(-4))}</span></p><button class="danger-mini" data-reset-reject="${item.id}">Recusar</button><button class="approve-mini" data-reset-approve="${item.id}">Gerar link</button></div>`).join("") : `<p class="muted">Nenhum pedido de recuperação aguardando atendimento.</p>`;
    await renderAdminOperations(operations);
  } catch (error) {
    $("#pending-drivers").innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
    if ($("#operations-updated")) $("#operations-updated").textContent = "Falha ao atualizar";
  } finally { adminRefreshRunning = false; }
  $$('[data-driver-action]').forEach(button => button.onclick = () => decideDriver(button.dataset.driverId, button.dataset.driverAction));
  $$('[data-reset-approve]').forEach(button => button.onclick = () => decidePasswordReset(button.dataset.resetApprove, "approve"));
  $$('[data-reset-reject]').forEach(button => button.onclick = () => decidePasswordReset(button.dataset.resetReject, "reject"));
}

async function decideDriver(id, action) {
  try { await api(`/api/admin/drivers/${id}/${action}`, { method: "POST" }); renderAdmin(); }
  catch (error) { alert(error.message); }
}

async function decidePasswordReset(id, action) {
  try {
    const result = await api(`/api/admin/password-resets/${id}/${action}`, { method: "POST" });
    if (action === "approve") showRecoveryShare(result);
    renderAdmin();
  } catch (error) { alert(error.message); }
}

function whatsappUrl(phone, message) {
  return `https://wa.me/${digits(phone, 13)}?text=${encodeURIComponent(message)}`;
}

function openWhatsApp(url) {
  window.location.assign(url);
}

function showRecoveryShare(result) {
  const text = `Olá, ${result.name}. Recebemos seu pedido de recuperação da Aura Bae. Use este link em até ${result.expiresInMinutes} minutos para criar uma nova senha: ${result.recoveryUrl}`;
  const url = whatsappUrl(`55${result.phone}`, text);
  const panel = $("#recovery-share");
  panel.innerHTML = `<small>Link temporário gerado</small><strong>${escapeHtml(result.name)}</strong><p>Válido por ${result.expiresInMinutes} minutos. Envie agora pelo WhatsApp.</p><div><button id="send-recovery-whatsapp" class="primary" type="button">Enviar pelo WhatsApp</button><button id="copy-recovery-link" class="secondary" type="button">Copiar link</button></div>`;
  panel.classList.remove("hidden");
  $("#send-recovery-whatsapp").onclick = () => openWhatsApp(url);
  $("#copy-recovery-link").onclick = async () => {
    try {
      await navigator.clipboard.writeText(result.recoveryUrl);
      $("#copy-recovery-link").textContent = "Link copiado";
    } catch { prompt("Copie o link abaixo:", result.recoveryUrl); }
  };
}

async function createDemoUsers() {
  const button = $("#create-demo-users");
  const output = $("#demo-users-result");
  button.disabled = true;
  button.textContent = "Criando contas…";
  output.classList.add("hidden");
  try {
    const result = await api("/api/admin/demo-users", { method: "POST" });
    output.innerHTML = `<p class="demo-success">Contas prontas. Envie estes dados aos seus amigos:</p>${result.users.map(user => `
      <article class="demo-credential">
        <div><small>${escapeHtml(user.kind)}</small><strong>${escapeHtml(user.name)}</strong>${user.vehicle ? `<span>${escapeHtml(user.vehicle)}</span>` : ""}</div>
        <dl><div><dt>Telefone</dt><dd>${escapeHtml(phoneText(user.phone))}</dd></div><div><dt>Senha</dt><dd>${escapeHtml(user.password)}</dd></div></dl>
        <button class="secondary" type="button" data-copy-demo="${escapeHtml(`${user.kind}: telefone ${phoneText(user.phone)}, senha ${user.password}`)}">Copiar acesso</button>
      </article>`).join("")}`;
    output.classList.remove("hidden");
    $$('[data-copy-demo]').forEach(copyButton => copyButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copyDemo);
        const previous = copyButton.textContent;
        copyButton.textContent = "Copiado";
        setTimeout(() => { copyButton.textContent = previous; }, 1400);
      } catch { alert(copyButton.dataset.copyDemo); }
    });
    renderAdmin();
  } catch (error) {
    output.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
    output.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Criar ou redefinir contas";
  }
}

$("#create-demo-users").onclick = createDemoUsers;

function renderProfile() {
  if (!currentUser) return;
  $("#profile-display-name").textContent = currentUser.name;
  $("#profile-contact").textContent = `${phoneText(currentUser.phone)} • CPF ${cpfText(currentUser.cpf)}`;
  $("#profile-name").value = currentUser.name;
  $("#profile-avatar").innerHTML = currentUser.profilePhoto ? `<img src="${currentUser.profilePhoto}" alt="Sua foto">` : escapeHtml(initials(currentUser.name));
  renderUserBadge();
  $("#profile-photo-preview").classList.toggle("hidden", !currentUser.profilePhoto);
  if (currentUser.profilePhoto) $("#profile-photo-preview").src = currentUser.profilePhoto;
  if (!croppedPhotoData.has("profile-photo")) updatePhotoPicker($("#profile-photo"), currentUser.profilePhoto, "Foto atual");
  const driverForm = $("#driver-application-form");
  driverForm.closest("article").classList.toggle("hidden", currentUser.role === "admin");
  $("#replay-passenger-tutorial").classList.toggle("hidden", currentUser.role === "admin");
  if (currentUser.role === "admin") return;
  $("#driver-profile-title").textContent = currentUser.canDrive ? "Meu perfil de motorista" : "Também quer dirigir?";
  $("#driver-profile-text").textContent = currentUser.canDrive ? "Atualize o veículo, as fotos ou a chave Pix quando precisar." : "Cadastre seus dados e comece a receber chamadas automaticamente.";
  $("#driver-profile-vehicle").value = currentUser.vehicleType || "mototaxi";
  $("#driver-profile-model").value = currentUser.vehicleModel || "";
  $("#driver-profile-pix-type").value = currentUser.pixKeyType || "CPF";
  $("#driver-application-submit").textContent = currentUser.canDrive ? "Salvar dados de motorista" : "Ativar perfil de motorista";
  $("#replay-driver-tutorial").classList.toggle("hidden", !currentUser.canDrive);
  $("#open-pix-settings").classList.toggle("hidden", currentUser.role === "admin");
  $("#open-pix-settings strong").textContent = currentUser.canDrive ? "Mudar chave Pix" : "Cadastrar chave Pix";
  const previews = [];
  if (currentUser.vehiclePhoto) previews.push(`<figure><img src="${currentUser.vehiclePhoto}" alt="Foto do veículo"><figcaption>Veículo</figcaption></figure>`);
  $("#driver-photo-previews").innerHTML = previews.join("");
  if (!croppedPhotoData.has("driver-profile-photo")) updatePhotoPicker($("#driver-profile-photo"), currentUser.profilePhoto, "Foto atual");
  if (!croppedPhotoData.has("driver-vehicle-photo")) updatePhotoPicker($("#driver-vehicle-photo"), currentUser.vehiclePhoto, "Foto atual");
}

$("#profile-form").onsubmit = async event => {
  event.preventDefault();
  const output = $("#profile-error"); output.classList.add("hidden");
  try {
    const result = await api("/api/profile", { method: "PATCH", body: { name: $("#profile-name").value, profilePhoto: await selectedPhotoData("profile-photo") } });
    currentUser = result.user;
    currentUser.vehicle = currentUser.vehicleType; currentUser.vehicleId = currentUser.vehicleModel;
    croppedPhotoData.delete("profile-photo");
    renderUserBadge();
    renderProfile();
    setMessage(output, "Perfil atualizado.", true);
  } catch (error) { setMessage(output, error.message); }
};

$("#driver-application-form").onsubmit = async event => {
  event.preventDefault();
  const output = $("#driver-profile-error"); output.classList.add("hidden");
  const submit = $("#driver-application-submit"); submit.disabled = true;
  try {
    const result = await api("/api/driver/apply", { method: "POST", body: {
      vehicleType: $("#driver-profile-vehicle").value,
      vehicleModel: $("#driver-profile-model").value,
      pixKeyType: $("#driver-profile-pix-type").value,
      pixKey: $("#driver-profile-pix-key").value,
      profilePhoto: await selectedPhotoData("driver-profile-photo"),
      vehiclePhoto: await selectedPhotoData("driver-vehicle-photo")
    } });
    currentUser = result.user;
    currentUser.vehicle = currentUser.vehicleType; currentUser.vehicleId = currentUser.vehicleModel;
    croppedPhotoData.delete("driver-profile-photo");
    croppedPhotoData.delete("driver-vehicle-photo");
    renderNav(); renderProfile(); renderDriverProfile();
    setMessage(output, "Perfil de motorista ativo. Você já pode ficar disponível.", true);
    showTutorial("driver");
  } catch (error) {
    setMessage(output, error.message);
    if (error.data?.field) document.getElementById(error.data.field)?.focus();
  } finally { submit.disabled = false; }
};

function openSettingsPanel(panelId) {
  ["password-settings-panel", "pix-settings-panel"].forEach(id => $("#" + id).classList.toggle("hidden", id !== panelId));
  $("#" + panelId).scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("#open-password-settings").onclick = () => openSettingsPanel("password-settings-panel");
$("#open-pix-settings").onclick = () => openSettingsPanel("pix-settings-panel");
$$('[data-close-settings]').forEach(button => button.onclick = () => $("#" + button.dataset.closeSettings).classList.add("hidden"));

$("#change-pix-form").onsubmit = async event => {
  event.preventDefault();
  const output = $("#pix-change-error"); output.classList.add("hidden");
  const pixKey = $("#driver-profile-pix-key").value.trim();
  if (!pixKey) return setMessage(output, "Digite a nova chave Pix.");
  try {
    if (currentUser.canDrive) {
      const result = await api("/api/profile/pix", { method: "POST", body: { pixKeyType: $("#driver-profile-pix-type").value, pixKey } });
      currentUser = result.user;
      $("#driver-profile-pix-key").value = "";
      setMessage(output, "Chave Pix alterada com sucesso.", true);
    } else {
      setMessage(output, "Chave preparada. Agora salve o cadastro de motorista.", true);
    }
  } catch (error) { setMessage(output, error.message); }
};

$("#change-password-form").onsubmit = async event => {
  event.preventDefault();
  const output = $("#password-change-error"); output.classList.add("hidden");
  const next = $("#new-password").value;
  if (next !== $("#confirm-new-password").value) return setMessage(output, "As duas novas senhas precisam ser iguais.");
  try {
    await api("/api/profile/password", { method: "POST", body: { currentPassword: $("#current-password").value, newPassword: next } });
    event.target.reset();
    setMessage(output, "Senha alterada. As outras sessões foram encerradas.", true);
  } catch (error) { setMessage(output, error.message); }
};

const tutorials = {
  passenger: [
    ["A", "Escolha como viajar", "Selecione Mototáxi, Motocarro ou Carro antes de montar sua rota."],
    ["A→B", "Marque no mapa", "Toque primeiro na saída e depois no destino. O sistema calcula a rota pelas ruas."],
    ["MT", "Aguarde um motorista", "A chamada aparece somente para motoristas ativos daquela categoria e próximos de você."],
    ["PIX", "Pague no destino", "O Pix ou o pagamento em dinheiro só é solicitado depois que o motorista confirma a chegada."]
  ],
  driver: [
    ["ON", "Fique disponível", "Ative o botão grande e permita a localização para receber chamadas próximas."],
    ["A", "Aceite a chamada", "Confira a distância até o passageiro e o valor líquido antes de aceitar."],
    ["B", "Atualize cada etapa", "Confirme o embarque e depois a chegada. Corridas aceitas sem atividade expiram em 5 minutos."],
    ["R$", "Confirme com cuidado", "No dinheiro, confirme após receber. No Pix, aguarde a confirmação automática."]
  ]
};
let tutorialMode = "passenger", tutorialStep = 0;

function showTutorial(mode = "passenger") {
  if (!tutorials[mode]) return;
  tutorialMode = mode; tutorialStep = 0;
  $("#tutorial-modal").classList.remove("hidden");
  renderTutorialStep();
}
function renderTutorialStep() {
  const slides = tutorials[tutorialMode], [icon, title, text] = slides[tutorialStep];
  $("#tutorial-step-label").textContent = `${tutorialMode === "driver" ? "Motorista" : "Passageiro"} • Passo ${tutorialStep + 1} de ${slides.length}`;
  $("#tutorial-icon").textContent = icon; $("#tutorial-title").textContent = title; $("#tutorial-text").textContent = text;
  $("#tutorial-dots").innerHTML = slides.map((_, index) => `<i class="${index === tutorialStep ? "active" : ""}"></i>`).join("");
  $("#tutorial-next").textContent = tutorialStep === slides.length - 1 ? "Entendi" : "Continuar";
}
async function closeTutorial() {
  $("#tutorial-modal").classList.add("hidden");
  if (currentUser) {
    currentUser.tutorialSeen ||= {};
    currentUser.tutorialSeen[tutorialMode] = true;
    try { await api("/api/profile/tutorial", { method: "POST", body: { mode: tutorialMode } }); } catch {}
  }
}
$("#tutorial-next").onclick = () => { if (tutorialStep < tutorials[tutorialMode].length - 1) { tutorialStep++; renderTutorialStep(); } else closeTutorial(); };
$("#tutorial-skip").onclick = closeTutorial;
$("#replay-passenger-tutorial").onclick = () => showTutorial("passenger");
$("#replay-driver-tutorial").onclick = () => showTutorial("driver");

function updateSupportLink() {
  if (!currentUser) return;
  const topic = $("#support-topic").value, message = $("#support-message").value;
  const text = `Olá, suporte Aura Bae. Meu nome é ${currentUser.name}, telefone ${phoneText(currentUser.phone)}. Assunto: ${topic}.${message ? ` Detalhes: ${message}` : ""}`;
  $("#support-link").dataset.whatsappUrl = whatsappUrl(supportPhone, text);
}
$("#support-topic").onchange = updateSupportLink; $("#support-message").oninput = updateSupportLink;
$("#support-link").onclick = () => openWhatsApp($("#support-link").dataset.whatsappUrl || whatsappUrl(supportPhone, "Olá, suporte Aura Bae."));

(async () => {
  try {
    const resetToken = new URLSearchParams(location.search).get("reset");
    if (resetToken) {
      showAuthCard("reset-card");
      return;
    }
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
