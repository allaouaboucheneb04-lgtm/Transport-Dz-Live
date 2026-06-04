(function () {
'use strict';

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
const $ = id => document.getElementById(id);
let currentUser = null, userRole = null;
let lines = [], stops = [], vehicles = [], drivers = [], driverRequests = [], walkingTracks = [], incidents = [];
let unsub = [], map = null, stopPickerMap = null, stopPickerMarker = null;
let pickedLat = null, pickedLng = null;
let clientMarker = null, driverWatchId = null, lastGpsWrite = 0;
let editingLineId = null, editingStopId = null, editingVehicleId = null, editingDriverId = null;
let routeCache = {}, routeFocusActive = false, routeLayers = [];
let osmStopsLayer = null, osmStopsGeojson = null;
let bejaiaGeojson = null, bejaiaGeojsonLayer = null;
let walkingTrackWatchId = null, walkingTrackPoints = [], walkingTrackStart = 0;

// ── Render debounce ─────────────────────────
let _renderTimer = null;
function scheduleRender() {
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(renderAll, 150);
}

// ── Constants ───────────────────────────────
const LINE_TOLERANCE_METERS = 500;
const GPS_STALE_MS = 90000;   // 90s — safe margin above 60s GPS freq
const ETA_BUS_KMH = 22;
const BUS_AVG_KMH = 22;
const WALK_MPS = 1.1;

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
const val = id => { const e = $(id); return e ? e.value : ''; };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const now = () => firebase.firestore.FieldValue.serverTimestamp();
const tsMillis = v => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v.toMillis) return v.toMillis();
  if (typeof v === 'string') return Date.parse(v) || 0;
  return 0;
};
function setText(id, t) { const e = $(id); if (e) e.textContent = t; }

// ── Toast (replaces all alert() calls) ──────
function toast(msg, type = 'default', duration = 3500) {
  const container = $('toastContainer');
  if (!container) { console.log(msg); return; }
  const el = document.createElement('div');
  el.className = `toast${type !== 'default' ? ` toast--${type}` : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration + 300);
}
function toastOk(msg) { toast('✅ ' + msg, 'success'); }
function toastErr(msg) { toast('❌ ' + msg, 'danger'); }
function toastWarn(msg) { toast('⚠️ ' + msg, 'warning'); }

// ── Guards ───────────────────────────────────
function requireAdmin() {
  if (userRole !== 'admin') { toastErr("Accès réservé à l'administrateur."); return false; }
  return true;
}
function requireAuth() {
  if (!currentUser) { toastErr("Connecte-toi d'abord."); return false; }
  return true;
}

// ── Distance ─────────────────────────────────
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function distanceVehicleToStop(v, stop) {
  if (!stop || num(v.lat) === null || num(stop.lat) === null) return Infinity;
  return distanceMeters(num(v.lat), num(v.lng), num(stop.lat), num(stop.lng));
}

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
function setFirebaseStatus(ok) {
  const el = $('firebaseStatus');
  if (!el) return;
  el.className = `statusDot ${ok ? 'statusDot--ok' : 'statusDot--error'}`;
}

async function loadRole() {
  userRole = null;
  if (!currentUser) { renderAuth(); return; }
  try {
    if (currentUser.email === 'allaouaboucheneb04@gmail.com') {
      userRole = 'admin';
    } else {
      const doc = await db.collection('users').doc(currentUser.uid).get();
      userRole = doc.exists ? (doc.data().role || 'client') : 'client';
    }
  } catch (e) { console.warn(e); userRole = 'client'; }
  renderAuth();
  applyRoleVisibility();
}

function renderAuth() {
  const btn = $('openLoginBtn');
  const avatarLabel = $('userAvatarLabel');
  if (currentUser) {
    if (btn) btn.style.background = '#dcfce7';
    const initials = (currentUser.email || '?').substring(0, 1).toUpperCase();
    if (avatarLabel) avatarLabel.textContent = initials;
  } else {
    if (btn) btn.style.background = '';
    if (avatarLabel) avatarLabel.textContent = 'Connexion';
  }
  setText('authStatus', currentUser ? `${currentUser.email} · ${userRole || 'client'}` : '');
}

function applyRoleVisibility() {
  const pending = $('driverPendingCard');
  if (pending) pending.classList.toggle('hidden', userRole !== 'driver_pending');
  const driverMain = $('driverMainCard');
  if (driverMain) driverMain.classList.toggle('hidden', userRole === 'driver_pending');
  // Show admin alert dot
  const dot = $('adminAlertDot');
  const pendingBadge = $('pendingBadge');
  const count = driverRequests.filter(r => r.status === 'pending').length;
  if (dot) dot.classList.toggle('hidden', count === 0);
  if (pendingBadge) {
    pendingBadge.textContent = count;
    pendingBadge.classList.toggle('hidden', count === 0);
  }
  const pendingAlert = $('pendingAlert');
  if (pendingAlert) {
    pendingAlert.classList.toggle('hidden', count === 0 || userRole !== 'admin');
    setText('pendingAlertText', `${count} chauffeur(s) attend(ent) validation`);
  }
}

function refreshAuthGate() {
  if (!currentUser && !window._guestMode) {
    showAuthGate(true);
  } else {
    showAuthGate(false);
  }
}

function showAuthGate(show) {
  const g = $('authGate');
  if (g) g.classList.toggle('hidden', !show);
}

function showAuthTab(tab) {
  const login = tab === 'login';
  if ($('authLoginBox')) $('authLoginBox').classList.toggle('hidden', !login);
  if ($('authSignupBox')) $('authSignupBox').classList.toggle('hidden', login);
  if ($('authTabLogin')) $('authTabLogin').classList.toggle('active', login);
  if ($('authTabSignup')) $('authTabSignup').classList.toggle('active', !login);
}

async function createUserProfileAfterSignup(user, role) {
  if (!user) return;
  if (role === 'driver') {
    await db.collection('driverRequests').doc(user.uid).set({
      uid: user.uid, email: user.email || '', name: user.email || '',
      status: 'pending', createdAt: now(), updatedAt: now()
    }, { merge: true });
    await db.collection('users').doc(user.uid).set({
      email: user.email || '', role: 'driver_pending', active: false, createdAt: now(), updatedAt: now()
    }, { merge: true });
  } else {
    await db.collection('clients').doc(user.uid).set({
      uid: user.uid, email: user.email || '', name: user.email || '', active: true, createdAt: now(), updatedAt: now()
    }, { merge: true });
    await db.collection('users').doc(user.uid).set({
      email: user.email || '', role: 'client', active: true, createdAt: now(), updatedAt: now()
    }, { merge: true });
  }
}

function setupAuthGateEvents() {
  if ($('authTabLogin')) $('authTabLogin').onclick = () => showAuthTab('login');
  if ($('authTabSignup')) $('authTabSignup').onclick = () => showAuthTab('signup');
  if ($('gateLoginBtn')) $('gateLoginBtn').onclick = async () => {
    try {
      setText('gateAuthStatus', 'Connexion...');
      const cred = await auth.signInWithEmailAndPassword(val('gateEmailLogin').trim(), val('gatePasswordLogin'));
      currentUser = cred.user;
      await loadRole();
      showAuthGate(false);
      openRoleHome();
      setText('gateAuthStatus', '');
    } catch (e) {
      let m = e.message || 'Erreur connexion';
      if (e.code === 'auth/invalid-credential') m = 'Email ou mot de passe incorrect.';
      if (e.code === 'auth/unauthorized-domain') m = 'Domaine non autorisé — ajoutez-le dans Firebase.';
      setText('gateAuthStatus', m);
    }
  };
  if ($('gateSignupBtn')) $('gateSignupBtn').onclick = async () => {
    try {
      setText('gateAuthStatus', 'Création du compte...');
      const role = val('gateSignupRole') || 'client';
      const cred = await auth.createUserWithEmailAndPassword(val('gateEmailSignup').trim(), val('gatePasswordSignup'));
      await createUserProfileAfterSignup(cred.user, role);
      currentUser = cred.user;
      await loadRole();
      showAuthGate(false);
      openRoleHome();
      toastOk(role === 'driver' ? 'Compte créé. En attente de validation.' : 'Bienvenue !');
    } catch (e) {
      setText('gateAuthStatus', e.message || 'Erreur inscription');
    }
  };
  if ($('continueGuestBtn')) $('continueGuestBtn').onclick = () => {
    window._guestMode = true;
    showAuthGate(false);
  };
}

// ── Role-based navigation ───────────────────
function roleHomePage() {
  if (userRole === 'admin') return 'admin';
  if (userRole === 'driver' || userRole === 'driver_pending') return 'driver';
  return 'client';
}

function openRoleHome() {
  switchPage(roleHomePage());
}

function switchPage(page) {
  const pageMap = { client: 'clientPage', driver: 'driverPage', admin: 'adminPage' };
  const targetId = pageMap[page] || (page + 'Page');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.navBtn').forEach(b => b.classList.remove('active'));
  const target = $(targetId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.navBtn').forEach(b => {
    if (b.dataset && b.dataset.page === targetId) b.classList.add('active');
  });
  setTimeout(() => { if (map && map.invalidateSize) map.invalidateSize(); }, 200);
}

function switchAdminTab(panelId) {
  document.querySelectorAll('.adminTab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.adminPanel').forEach(p => p.classList.remove('active'));
  const tab = document.querySelector(`[data-panel="${panelId}"]`);
  if (tab) tab.classList.add('active');
  const panel = $(panelId);
  if (panel) panel.classList.add('active');
}
window.switchAdminTab = switchAdminTab;

// ═══════════════════════════════════════════
// FIREBASE REALTIME
// ═══════════════════════════════════════════
function bindRealtime() {
  unsub.forEach(f => f && f());
  unsub = [];
  unsub.push(db.collection('lines').onSnapshot(s => { lines = s.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRender(); }, console.error));
  unsub.push(db.collection('stops').onSnapshot(s => { stops = s.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRender(); }, console.error));
  unsub.push(db.collection('vehicles').onSnapshot(s => { vehicles = s.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRender(); renderDriverWorkStatus(); }, console.error));
  unsub.push(db.collection('drivers').onSnapshot(s => { drivers = s.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRender(); }, console.error));
  unsub.push(db.collection('driverRequests').where('status', '==', 'pending').onSnapshot(s => { driverRequests = s.docs.map(d => ({ id: d.id, ...d.data() })); applyRoleVisibility(); renderPendingDrivers(); }, console.error));
  // Incidents
  unsub.push(db.collection('reports').orderBy('createdAt', 'desc').limit(50).onSnapshot(s => { incidents = s.docs.map(d => ({ id: d.id, ...d.data() })); renderIncidents(); updateAdminStats(); }, e => console.warn('reports:', e)));
}

// ═══════════════════════════════════════════
// CORE HELPERS (lines/stops/vehicles)
// ═══════════════════════════════════════════
const isLineActive = lineId => { const l = lines.find(x => x.id === lineId); return !l || l.active !== false; };
const activeStopsOnly = () => stops.filter(s => s.active !== false && isLineActive(s.lineId));
const getLineById = id => lines.find(l => l.id === id) || null;
const getLineName = id => { const l = getLineById(id); return l ? (l.name || id) : id; };
const getBusIcon = () => L.divIcon({ className: 'busMarker', html: '🚌', iconSize: [36, 36], iconAnchor: [18, 18] });
const getMyPosIcon = () => L.divIcon({ className: 'myPositionMarker', html: '', iconSize: [16, 16], iconAnchor: [8, 8] });

function stopsForLine(lineId) {
  if (!lineId || lineId === 'all') return [];
  return activeStopsOnly().filter(s => s.lineId === lineId && num(s.lat) !== null && num(s.lng) !== null)
    .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999));
}

function nearestDistanceToLineStops(vehicle) {
  const vLat = num(vehicle.lat), vLng = num(vehicle.lng);
  if (vLat === null || vLng === null || !vehicle.lineId) return Infinity;
  const routeStops = stops.filter(s => s.lineId === vehicle.lineId && num(s.lat) !== null && num(s.lng) !== null);
  if (!routeStops.length) return 0;
  return Math.min(...routeStops.map(s => distanceMeters(vLat, vLng, num(s.lat), num(s.lng))));
}

function computeVisibility(vehicle) {
  const online = vehicle.status === 'online';
  const recent = Date.now() - tsMillis(vehicle.lastGpsUpdate || vehicle.updatedAt) < GPS_STALE_MS;
  const dist = nearestDistanceToLineStops(vehicle);
  const near = dist <= LINE_TOLERANCE_METERS;
  return { online, recent, near, visible: online && recent && near, distance: dist };
}

function visibleVehiclesForClients() {
  return vehicles.filter(v => computeVisibility(v).visible);
}

function driverName(driverId) {
  if (!driverId) return '—';
  const d = drivers.find(x => x.id === driverId);
  return d ? (d.name || d.email || driverId) : driverId;
}

function directionLabel(d) {
  if (d === 'aller') return 'Aller →';
  if (d === 'retour') return '← Retour';
  return 'Aller + Retour';
}

// ═══════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════
function initMap() {
  if (map) return;
  const mapEl = $('fullMap');
  if (!mapEl) return;
  map = L.map('fullMap', { zoomControl: true }).setView([36.75, 5.05], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
  window.map = map;
}

function clearRouteLayers() {
  routeLayers.forEach(l => { try { map && map.removeLayer(l); } catch (e) {} });
  routeLayers = [];
}

async function drawRouteForLine(line, routeStops) {
  if (routeStops.length < 2) return;
  const key = line.id + '_' + routeStops.map(s => s.id).join(',');
  let latlngs = routeCache[key];
  if (!latlngs) {
    const coords = routeStops.map(s => `${num(s.lng)},${num(s.lat)}`).join(';');
    try {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes[0]) {
          latlngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          routeCache[key] = latlngs;
        }
      }
    } catch (e) { /* OSRM unavailable, fallback to straight lines */ }
    if (!latlngs) latlngs = routeStops.map(s => [num(s.lat), num(s.lng)]);
  }
  if (!map) return;
  const poly = L.polyline(latlngs, { color: line.color || '#1a56db', weight: 4, opacity: 0.8 }).addTo(map);
  routeLayers.push(poly);
}

async function drawMap() {
  if (!map) return;
  if (routeFocusActive) return;
  map.eachLayer(layer => {
    if (layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polyline)
      map.removeLayer(layer);
  });
  clearRouteLayers();
  const selected = val('clientLineSelect') || 'all';
  const city = val('clientCity') || 'Bejaia';
  const cityLines = lines.filter(l => !l.city || l.city === city);
  const visible = activeStopsOnly().filter(s => {
    const l = getLineById(s.lineId);
    if (!l) return false;
    if (l.city && l.city !== city) return false;
    if (selected !== 'all' && s.lineId !== selected) return false;
    return num(s.lat) !== null && num(s.lng) !== null;
  });
  // Draw stops
  visible.forEach(s => {
    const color = getLineById(s.lineId)?.color || '#1a56db';
    L.circleMarker([num(s.lat), num(s.lng)], { radius: 7, color, fillColor: color, weight: 2, fillOpacity: 0.9 })
      .addTo(map).bindPopup(`🚏 <b>${s.name}</b><br>${getLineName(s.lineId)}`);
  });
  // Draw route lines
  const linesToDraw = selected === 'all' ? cityLines : cityLines.filter(l => l.id === selected);
  for (const line of linesToDraw) {
    const rs = stopsForLine(line.id);
    if (rs.length > 1) await drawRouteForLine(line, rs);
  }
  // Draw buses
  visibleVehiclesForClients().forEach(v => {
    if (num(v.lat) === null || num(v.lng) === null) return;
    L.marker([num(v.lat), num(v.lng)], { icon: getBusIcon() })
      .addTo(map)
      .bindPopup(`🚌 <b>${v.name}</b><br>${getLineName(v.lineId)}<br>En ligne · ${v.speedKmh || 0} km/h`);
  });
  if (clientMarker) clientMarker.addTo(map);
  // Update map status
  const onlineCount = visibleVehiclesForClients().length;
  const stopCount = visible.length;
  setText('mapStatus', `${onlineCount} bus en direct · ${stopCount} arrêts`);
}

// ── Fullscreen map ────────────────────────────
function openFullMap() {
  const overlay = $('mapOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  setTimeout(() => {
    initMap();
    if (map) { map.invalidateSize(true); drawMap(); }
  }, 100);
  setTimeout(() => { if (map) map.invalidateSize(true); }, 500);
}

function closeFullMap() {
  const overlay = $('mapOverlay');
  if (overlay) overlay.classList.add('hidden');
}

// ═══════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════
function renderAll() {
  renderSelects();
  renderClientBusList();
  renderWaitingBuses();
  renderEtaStopSelect();
  renderEtaList();
  renderStopsList();
  renderVehiclesList();
  renderPendingDrivers();
  renderLists();
  updateAdminStats();
  drawMap().catch(console.error);
}

// ═══════════════════════════════════════════
// SELECTS
// ═══════════════════════════════════════════
function renderSelects() {
  const city = val('clientCity') || 'Bejaia';
  const cityLines = lines.filter(l => !l.city || l.city === city);
  const oldLine = val('clientLineSelect');
  if ($('clientLineSelect')) {
    $('clientLineSelect').innerHTML = '<option value="all">Toutes les lignes</option>' +
      cityLines.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    if ([...$('clientLineSelect').options].some(o => o.value === oldLine)) $('clientLineSelect').value = oldLine;
  }
  const lineOpts = lines.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  if ($('stopLineSelect')) $('stopLineSelect').innerHTML = lineOpts;
  if ($('vehicleLineSelect')) $('vehicleLineSelect').innerHTML = lineOpts;
  if ($('adminStopsLineFilter')) $('adminStopsLineFilter').innerHTML = '<option value="all">Toutes les lignes</option>' + lineOpts;
  if ($('osmImportLineSelect')) $('osmImportLineSelect').innerHTML = '<option value="">Choisir une ligne...</option>' + lineOpts;
  if ($('bejaiaImportLineSelect')) $('bejaiaImportLineSelect').innerHTML = '<option value="">Choisir une ligne...</option>' + lineOpts;
  const driverOpts = '<option value="">Aucun chauffeur</option>' + drivers.map(d => `<option value="${d.id}">${d.name || d.email || d.id}</option>`).join('');
  if ($('vehicleDriverSelect')) $('vehicleDriverSelect').innerHTML = driverOpts;
  if ($('driverVehicleSelect')) $('driverVehicleSelect').innerHTML = vehicles.map(v => `<option value="${v.id}">${v.name} · ${getLineName(v.lineId)}</option>`).join('');
  // Terminus selects
  const stopOpts = '<option value="">Auto / aucun</option>' + stops.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  if ($('lineStartStopSelect')) $('lineStartStopSelect').innerHTML = stopOpts;
  if ($('lineEndStopSelect')) $('lineEndStopSelect').innerHTML = stopOpts;
  // Walking selects
  const walkOpts = stops.map(s => `<option value="${s.id}">${s.name} · ${getLineName(s.lineId)}</option>`).join('');
  if ($('walkFromStopSelect')) $('walkFromStopSelect').innerHTML = walkOpts;
  if ($('walkToStopSelect')) $('walkToStopSelect').innerHTML = walkOpts;
  // Update city label
  const cityNames = { Bejaia: 'Béjaïa', Alger: 'Alger', Oran: 'Oran', Constantine: 'Constantine', Tizi: 'Tizi Ouzou', Annaba: 'Annaba' };
  setText('appCityLabel', cityNames[city] || city);
}

// ═══════════════════════════════════════════
// CLIENT PAGE RENDERING
// ═══════════════════════════════════════════
function renderClientBusList() {
  const box = $('livebusesList');
  if (!box) return;
  const city = val('clientCity') || 'Bejaia';
  const selected = val('clientLineSelect') || 'all';
  const online = visibleVehiclesForClients().filter(v => {
    const l = getLineById(v.lineId);
    if (l && l.city && l.city !== city) return false;
    if (selected !== 'all' && v.lineId !== selected) return false;
    return true;
  });
  if (!online.length) {
    box.innerHTML = `<div class="emptyState"><span>🚌</span>Aucun bus en ligne pour l'instant.</div>`;
    return;
  }
  box.innerHTML = online.map(v => {
    const eta = etaForVehicleDisplay(v);
    return `<div class="busCard busCard--online">
      <div class="busIconBig">🚌</div>
      <div class="busInfo">
        <div class="busName">${v.name || 'Bus'}</div>
        <div class="busLine">${getLineName(v.lineId)} · ${directionLabel(v.direction)}</div>
        <div class="busMeta">
          <span class="busStatusBadge busStatusBadge--online">En ligne</span>
          ${v.speedKmh ? `<span class="busSpeed">${v.speedKmh} km/h</span>` : ''}
        </div>
      </div>
      ${eta ? `<div class="busEta">${eta}</div>` : ''}
    </div>`;
  }).join('');
}

function etaForVehicleDisplay(v) {
  if (num(v.lat) === null) return null;
  const d = nearestDistanceToLineStops(v);
  if (d === Infinity) return null;
  const min = Math.max(1, Math.round((d / (ETA_BUS_KMH * 1000 / 3600)) / 60));
  return `~${min} min`;
}

function renderWaitingBuses() {
  const box = $('waitingBusesList');
  const card = $('waitingCard');
  if (!box || !card) return;
  // Buses online but not moving (speed=0, at terminus)
  const waiting = vehicles.filter(v => {
    if (v.status !== 'online') return false;
    const c = computeVisibility(v);
    return c.online && c.recent;
  });
  if (!waiting.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  box.innerHTML = waiting.map(v => `
    <div class="busCard busCard--waiting">
      <div class="busIconBig">🚌</div>
      <div class="busInfo">
        <div class="busName">${v.name || 'Bus'}</div>
        <div class="busLine">${getLineName(v.lineId)}</div>
        <div class="busMeta"><span class="busStatusBadge busStatusBadge--waiting">En attente</span></div>
      </div>
    </div>`).join('');
}

function renderStopsList() {
  const box = $('stopsList');
  if (!box) return;
  const selected = val('clientLineSelect') || 'all';
  const city = val('clientCity') || 'Bejaia';
  const visible = activeStopsOnly().filter(s => {
    const l = getLineById(s.lineId);
    if (l && l.city && l.city !== city) return false;
    return selected === 'all' || s.lineId === selected;
  }).sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999));
  if (!visible.length) { box.innerHTML = '<div class="emptyState">Aucun arrêt.</div>'; return; }
  box.innerHTML = visible.map(s => `
    <div class="stopItem">
      <span class="stopDot" style="background:${getLineById(s.lineId)?.color || '#1a56db'}"></span>
      <span>${s.name}</span>
    </div>`).join('');
}

function renderVehiclesList() {
  const box = $('vehiclesList');
  if (!box) return;
  if (!vehicles.length) { box.innerHTML = '<div class="emptyState">Aucun véhicule.</div>'; return; }
  box.innerHTML = vehicles.map(v => {
    const c = computeVisibility(v);
    return `<div class="busCard ${c.visible ? 'busCard--online' : ''}">
      <div class="busIconBig">🚌</div>
      <div class="busInfo">
        <div class="busName">${v.name}</div>
        <div class="busLine">${getLineName(v.lineId)} · ${driverName(v.driverId)}</div>
        <div class="busMeta">
          <span class="busStatusBadge ${c.visible ? 'busStatusBadge--online' : ''}" style="${!c.visible ? 'background:#f3f4f6;color:#6b7280' : ''}">${c.visible ? 'Visible client' : 'Hors ligne'}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// ETA
// ═══════════════════════════════════════════
function renderEtaStopSelect() {
  const sel = $('etaStopSelect');
  if (!sel) return;
  const old = sel.value;
  sel.innerHTML = '<option value="">Choisir un arrêt...</option>' +
    activeStopsOnly().map(s => `<option value="${s.id}">${s.name} · ${getLineName(s.lineId)}</option>`).join('');
  if ([...sel.options].some(o => o.value === old)) sel.value = old;
}

function etaForStop(stop) {
  const online = visibleVehiclesForClients().filter(v => v.lineId === stop.lineId && num(v.lat) !== null);
  if (!online.length) return null;
  return online.map(v => {
    const d = distanceMeters(num(v.lat), num(v.lng), num(stop.lat), num(stop.lng));
    const minutes = Math.max(1, Math.round((d / (ETA_BUS_KMH * 1000 / 3600)) / 60));
    return { vehicle: v, distance: d, minutes };
  }).sort((a, b) => a.minutes - b.minutes)[0];
}

function renderEta() {
  const box = $('etaResult');
  if (!box) return;
  const stopId = val('etaStopSelect');
  const stop = stops.find(s => s.id === stopId);
  if (!stop) { box.innerHTML = 'Sélectionne un arrêt.'; return; }
  const eta = etaForStop(stop);
  if (!eta) {
    box.innerHTML = `<div>Aucun bus en ligne sur la ligne <b>${getLineName(stop.lineId)}</b>.</div>`;
    return;
  }
  const dist = eta.distance >= 1000 ? (eta.distance / 1000).toFixed(1) + ' km' : Math.round(eta.distance) + ' m';
  box.innerHTML = `
    <div class="etaBig">🚌 Arrive dans <b>${eta.minutes} min</b></div>
    <div class="etaMeta">Ligne : <b>${getLineName(stop.lineId)}</b><br>Arrêt : <b>${stop.name}</b><br>Distance bus → arrêt : <b>${dist}</b></div>`;
}

function renderEtaList() {
  const box = $('etaList');
  if (!box) return;
  const selected = val('clientLineSelect') || 'all';
  const city = val('clientCity') || 'Bejaia';
  const stopsToShow = activeStopsOnly().filter(s => {
    const l = getLineById(s.lineId);
    if (l && l.city && l.city !== city) return false;
    return selected === 'all' || s.lineId === selected;
  }).slice(0, 12);
  if (!stopsToShow.length) { box.innerHTML = '<div class="emptyState">Aucun arrêt.</div>'; return; }
  box.innerHTML = stopsToShow.map(s => {
    const eta = etaForStop(s);
    return `<div class="etaItem">
      <span class="etaStopName">🚏 ${s.name}</span>
      <span class="etaTime">${eta ? eta.minutes + ' min' : '—'}</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// ADMIN STATS
// ═══════════════════════════════════════════
function updateAdminStats() {
  const driversOnline = vehicles.filter(v => v.status === 'online').length;
  const linesActive = lines.filter(l => l.active !== false).length;
  const incidentsActive = incidents.filter(i => !i.archived).length;
  setText('statDriversOnline', driversOnline);
  setText('statLinesActive', linesActive);
  setText('statTotalStops', stops.length);
  setText('statIncidents', incidentsActive);
  const incCard = $('statIncidentsCard');
  if (incCard) incCard.classList.toggle('statCard--alert', incidentsActive > 0);
}

// ═══════════════════════════════════════════
// ADMIN LISTS
// ═══════════════════════════════════════════
function renderLists() {
  renderLinesAdminList();
  renderStopsAdminList();
  renderVehiclesAdminList();
  renderDriversAdminList();
  renderIncidents();
}

function renderLinesAdminList() {
  const box = $('linesAdminList');
  if (!box) return;
  setText('linesCount', lines.length);
  if (!lines.length) { box.innerHTML = '<div class="emptyState">Aucune ligne.</div>'; return; }
  box.innerHTML = lines.map(l => `
    <div class="adminItem">
      <div style="width:12px;height:12px;border-radius:50%;background:${l.color || '#1a56db'};flex-shrink:0"></div>
      <div class="adminItemInfo">
        <div class="adminItemName">${l.name}</div>
        <div class="adminItemMeta">${l.city || ''} · ${l.type || 'bus'} · ${l.active !== false ? 'Active' : 'Inactive'}</div>
      </div>
      <div class="adminItemActions">
        <button class="adminBtnEdit" onclick="editLine('${l.id}')">Modifier</button>
        <button class="adminBtnToggle" onclick="setLineActive('${l.id}',${l.active === false})">${l.active === false ? 'Activer' : 'Pause'}</button>
        <button class="adminBtnDelete" onclick="deleteLine('${l.id}')">✕</button>
      </div>
    </div>`).join('');
}

function renderStopsAdminList() {
  const box = $('stopsAdminList');
  if (!box) return;
  const lineFilter = val('adminStopsLineFilter') || 'all';
  const q = (val('adminStopsSearch') || '').trim().toLowerCase();
  const filtered = stops.filter(s => {
    if (lineFilter !== 'all' && s.lineId !== lineFilter) return false;
    if (q) {
      const text = `${s.name || ''} ${getLineName(s.lineId)} ${s.lat} ${s.lng}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });
  setText('stopsCount', filtered.length);
  setText('adminStopsCount', `${filtered.length} arrêt(s) affiché(s)`);
  if (!filtered.length) { box.innerHTML = '<div class="emptyState">Aucun arrêt.</div>'; return; }
  box.innerHTML = filtered.map(s => `
    <div class="adminItem">
      <span style="font-size:16px">🚏</span>
      <div class="adminItemInfo">
        <div class="adminItemName">${s.name}</div>
        <div class="adminItemMeta">${getLineName(s.lineId)} · ${directionLabel(s.direction)} · ${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}</div>
      </div>
      <div class="adminItemActions">
        <button class="adminBtnEdit" onclick="editStop('${s.id}')">Modifier</button>
        <button class="adminBtnDelete" onclick="deleteStop('${s.id}')">✕</button>
      </div>
    </div>`).join('');
}

function renderVehiclesAdminList() {
  const box = $('vehiclesAdminList');
  if (!box) return;
  setText('vehiclesCount', vehicles.length);
  if (!vehicles.length) { box.innerHTML = '<div class="emptyState">Aucun véhicule.</div>'; return; }
  box.innerHTML = vehicles.map(v => {
    const c = computeVisibility(v);
    return `<div class="adminItem ${c.visible ? 'adminItem--online' : ''}">
      <span style="font-size:20px">🚌</span>
      <div class="adminItemInfo">
        <div class="adminItemName">${v.name}</div>
        <div class="adminItemMeta">${getLineName(v.lineId)} · ${driverName(v.driverId)} · ${v.status || 'offline'} · ${c.visible ? '✅ visible' : '—'}</div>
      </div>
      <div class="adminItemActions">
        <button class="adminBtnEdit" onclick="editVehicle('${v.id}')">Modifier</button>
        <button class="adminBtnDelete" onclick="deleteVehicle('${v.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderDriversAdminList() {
  const box = $('driversAdminList');
  if (!box) return;
  setText('driversCount', drivers.length);
  if (!drivers.length) { box.innerHTML = '<div class="emptyState">Aucun chauffeur enregistré.</div>'; return; }
  box.innerHTML = drivers.map(d => `
    <div class="adminItem">
      <span style="font-size:20px">👤</span>
      <div class="adminItemInfo">
        <div class="adminItemName">${d.name || d.email}</div>
        <div class="adminItemMeta">${d.phone || ''} · ${d.email || ''}</div>
      </div>
      <div class="adminItemActions">
        <button class="adminBtnEdit" onclick="editDriver('${d.id}')">Modifier</button>
        <button class="adminBtnDelete" onclick="deleteDriver('${d.id}')">✕</button>
      </div>
    </div>`).join('');
}

function renderPendingDrivers() {
  const box = $('pendingDriversList');
  if (!box) return;
  const pending = driverRequests.filter(r => r.status === 'pending');
  setText('pendingCount', pending.length);
  if (!pending.length) { box.innerHTML = '<div class="emptyState">Aucune demande en attente. ✅</div>'; return; }
  box.innerHTML = pending.map(r => `
    <div class="adminItem">
      <span style="font-size:20px">🧑‍✈️</span>
      <div class="adminItemInfo">
        <div class="adminItemName">${r.name || r.email}</div>
        <div class="adminItemMeta">${r.email} · Demande le ${r.createdAt ? new Date(tsMillis(r.createdAt)).toLocaleDateString('fr-FR') : '?'}</div>
      </div>
      <div class="adminItemActions">
        <button class="adminBtnApprove" onclick="approveDriver('${r.id}')">✓ Valider</button>
        <button class="adminBtnDelete" onclick="rejectDriver('${r.id}')">✕ Refuser</button>
      </div>
    </div>`).join('');
}

function renderIncidents() {
  const box = $('incidentsList');
  if (!box) return;
  const active = incidents.filter(i => !i.archived);
  if (!active.length) { box.innerHTML = '<div class="emptyState">Aucun incident signalé. ✅</div>'; return; }
  const typeLabels = { panne: '🔧 Panne', accident: '🚨 Accident', deviation: '🔀 Déviation', retard: '⏰ Retard', autre: '📝 Autre' };
  box.innerHTML = active.map(inc => `
    <div class="incidentCard">
      <div class="incidentHeader">
        <span class="incidentType">${typeLabels[inc.type] || inc.type}</span>
        <span class="incidentTime">${inc.createdAt ? new Date(tsMillis(inc.createdAt)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
      ${inc.note ? `<div class="incidentNote">${inc.note}</div>` : ''}
      <div class="incidentDriver">🚌 ${inc.vehicleName || '—'} · ${inc.driverName || '—'}</div>
      <button class="adminBtnToggle" style="margin-top:6px" onclick="archiveIncident('${inc.id}')">Archiver</button>
    </div>`).join('');
}

// ═══════════════════════════════════════════
// CRUD HELPERS
// ═══════════════════════════════════════════
async function addDoc(col, data, statusId) {
  try {
    await db.collection(col).add(data);
    if (statusId) { const el = $(statusId); if (el) { el.textContent = 'Enregistré ✅'; el.className = 'formStatus status--ok'; } }
    return true;
  } catch (e) {
    console.error(e);
    if (statusId) { const el = $(statusId); if (el) { el.textContent = 'Erreur: ' + (e.message || e); el.className = 'formStatus status--error'; } }
    toastErr('Erreur Firebase: ' + (e.message || e));
    return false;
  }
}

async function updateDoc(col, docId, data, statusId) {
  try {
    await db.collection(col).doc(docId).update({ ...data, updatedAt: now() });
    if (statusId) { const el = $(statusId); if (el) { el.textContent = 'Mis à jour ✅'; el.className = 'formStatus status--ok'; } }
    return true;
  } catch (e) {
    console.error(e);
    if (statusId) { const el = $(statusId); if (el) { el.textContent = 'Erreur: ' + (e.message || e); el.className = 'formStatus status--error'; } }
    toastErr('Firebase: ' + (e.message || e));
    return false;
  }
}

// ═══════════════════════════════════════════
// LINES CRUD
// ═══════════════════════════════════════════
async function saveLine() {
  if (!requireAdmin()) return;
  const btn = $('addLineBtn'); if (btn) btn.disabled = true;
  const name = val('lineNameInput').trim();
  if (!name) { toastErr('Nom de ligne obligatoire'); if (btn) btn.disabled = false; return; }
  const data = {
    city: val('lineCity') || 'Bejaia', name, type: val('lineType') || 'bus',
    color: val('lineColor') || '#1a56db', active: true,
    startStopId: val('lineStartStopSelect') || null, endStopId: val('lineEndStopSelect') || null
  };
  let ok = false;
  if (editingLineId) ok = await updateDoc('lines', editingLineId, data, 'lineStatus');
  else ok = await addDoc('lines', { ...data, createdAt: now(), updatedAt: now() }, 'lineStatus');
  if (ok) { resetEdit('line'); toastOk(editingLineId ? 'Ligne mise à jour.' : 'Ligne ajoutée.'); }
  if (btn) btn.disabled = false;
}

async function setLineActive(lineId, active) {
  if (!requireAdmin()) return;
  try {
    await db.collection('lines').doc(lineId).update({ active, updatedAt: now() });
    toastOk(active ? 'Ligne activée.' : 'Ligne mise en pause.');
  } catch (e) { toastErr(e.message); }
}

async function deleteLine(lineId) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer cette ligne ? Les arrêts liés resteront dans Firestore.')) return;
  await db.collection('lines').doc(lineId).delete();
  toastOk('Ligne supprimée.');
}
window.deleteLine = deleteLine; window.setLineActive = setLineActive;

function editLine(id) {
  const l = lines.find(x => x.id === id);
  if (!l) return;
  editingLineId = id;
  if ($('lineNameInput')) $('lineNameInput').value = l.name || '';
  if ($('lineCity')) $('lineCity').value = l.city || 'Bejaia';
  if ($('lineType')) $('lineType').value = l.type || 'bus';
  if ($('lineColor')) $('lineColor').value = l.color || '#1a56db';
  if ($('lineStartStopSelect')) $('lineStartStopSelect').value = l.startStopId || '';
  if ($('lineEndStopSelect')) $('lineEndStopSelect').value = l.endStopId || '';
  if ($('addLineBtn')) $('addLineBtn').textContent = 'Mettre à jour';
  if ($('cancelLineEditBtn')) $('cancelLineEditBtn').classList.remove('hidden');
  if ($('linePanelTitle')) $('linePanelTitle').textContent = 'Modifier la ligne';
  switchAdminTab('panelLines');
  $('panelLines')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.editLine = editLine;

// ═══════════════════════════════════════════
// STOPS CRUD
// ═══════════════════════════════════════════
async function saveStop() {
  if (!requireAdmin()) return;
  const btn = $('addStopBtn'); if (btn) btn.disabled = true;
  const name = val('stopName').trim();
  const lat = num(val('stopLat')), lng = num(val('stopLng'));
  const lineId = val('stopLineSelect');
  if (!name) { toastErr('Nom arrêt obligatoire'); if (btn) btn.disabled = false; return; }
  if (!lineId) { toastErr('Choisir une ligne'); if (btn) btn.disabled = false; return; }
  if (lat === null || lng === null) { toastErr('Latitude/longitude invalide'); if (btn) btn.disabled = false; return; }
  const data = { lineId, lineName: getLineName(lineId), name, lat, lng, order: Number(val('stopOrder') || 0), direction: val('stopDirection') || 'both', active: true };
  let ok = false;
  if (editingStopId) ok = await updateDoc('stops', editingStopId, data, 'stopStatus');
  else ok = await addDoc('stops', { ...data, createdAt: now(), updatedAt: now() }, 'stopStatus');
  if (ok) { resetEdit('stop'); toastOk(editingStopId ? 'Arrêt mis à jour.' : 'Arrêt ajouté.'); }
  if (btn) btn.disabled = false;
}

async function deleteStop(stopId) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer cet arrêt ?')) return;
  await db.collection('stops').doc(stopId).delete();
  toastOk('Arrêt supprimé.');
}
window.deleteStop = deleteStop;

function editStop(id) {
  const s = stops.find(x => x.id === id);
  if (!s) return;
  editingStopId = id;
  if ($('stopName')) $('stopName').value = s.name || '';
  if ($('stopLineSelect')) $('stopLineSelect').value = s.lineId || '';
  if ($('stopLat')) $('stopLat').value = s.lat || '';
  if ($('stopLng')) $('stopLng').value = s.lng || '';
  if ($('stopOrder')) $('stopOrder').value = s.order || '';
  if ($('stopDirection')) $('stopDirection').value = s.direction || 'both';
  if ($('addStopBtn')) $('addStopBtn').textContent = 'Mettre à jour';
  if ($('cancelStopEditBtn')) $('cancelStopEditBtn').classList.remove('hidden');
  if ($('stopPanelTitle')) $('stopPanelTitle').textContent = 'Modifier l\'arrêt';
  switchAdminTab('panelStops');
}
window.editStop = editStop;

// ═══════════════════════════════════════════
// VEHICLES CRUD
// ═══════════════════════════════════════════
async function saveVehicle() {
  if (!requireAdmin()) return;
  const btn = $('addVehicleBtn'); if (btn) btn.disabled = true;
  const name = val('vehicleName').trim();
  if (!name) { toastErr('Nom véhicule obligatoire'); if (btn) btn.disabled = false; return; }
  const data = { name, lineId: val('vehicleLineSelect'), driverId: val('vehicleDriverSelect') || null, active: true };
  let ok = false;
  if (editingVehicleId) ok = await updateDoc('vehicles', editingVehicleId, data, 'vehicleStatus');
  else ok = await addDoc('vehicles', { ...data, status: 'offline', visibleToClients: false, lat: null, lng: null, createdAt: now(), updatedAt: now() }, 'vehicleStatus');
  if (ok) { resetEdit('vehicle'); toastOk(editingVehicleId ? 'Véhicule mis à jour.' : 'Véhicule ajouté.'); }
  if (btn) btn.disabled = false;
}

async function deleteVehicle(vehicleId) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer ce véhicule ?')) return;
  await db.collection('vehicles').doc(vehicleId).delete();
  toastOk('Véhicule supprimé.');
}
window.deleteVehicle = deleteVehicle;

function editVehicle(id) {
  const v = vehicles.find(x => x.id === id);
  if (!v) return;
  editingVehicleId = id;
  if ($('vehicleName')) $('vehicleName').value = v.name || '';
  if ($('vehicleLineSelect')) $('vehicleLineSelect').value = v.lineId || '';
  if ($('vehicleDriverSelect')) $('vehicleDriverSelect').value = v.driverId || '';
  if ($('addVehicleBtn')) $('addVehicleBtn').textContent = 'Mettre à jour';
  if ($('cancelVehicleEditBtn')) $('cancelVehicleEditBtn').classList.remove('hidden');
  if ($('vehiclePanelTitle')) $('vehiclePanelTitle').textContent = 'Modifier le véhicule';
  switchAdminTab('panelVehicles');
}
window.editVehicle = editVehicle;

// ═══════════════════════════════════════════
// DRIVERS CRUD
// ═══════════════════════════════════════════
async function saveDriver() {
  if (!requireAdmin()) return;
  const btn = $('addDriverBtn'); if (btn) btn.disabled = true;
  const name = val('driverNameAdmin').trim();
  if (!name) { toastErr('Nom chauffeur obligatoire'); if (btn) btn.disabled = false; return; }
  const data = { name, phone: val('driverPhoneAdmin').trim(), email: val('driverEmailAdmin').trim(), uid: val('driverEmailAdmin').trim(), active: true };
  let ok = false;
  if (editingDriverId) ok = await updateDoc('drivers', editingDriverId, data, 'driverAdminStatus');
  else ok = await addDoc('drivers', { ...data, createdAt: now(), updatedAt: now() }, 'driverAdminStatus');
  if (ok) { resetEdit('driver'); toastOk(editingDriverId ? 'Chauffeur mis à jour.' : 'Chauffeur ajouté.'); }
  if (btn) btn.disabled = false;
}

async function deleteDriver(driverId) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer ce chauffeur ?')) return;
  await db.collection('drivers').doc(driverId).delete();
  toastOk('Chauffeur supprimé.');
}
window.deleteDriver = deleteDriver;

function editDriver(id) {
  const d = drivers.find(x => x.id === id);
  if (!d) return;
  editingDriverId = id;
  if ($('driverNameAdmin')) $('driverNameAdmin').value = d.name || '';
  if ($('driverPhoneAdmin')) $('driverPhoneAdmin').value = d.phone || '';
  if ($('driverEmailAdmin')) $('driverEmailAdmin').value = d.email || d.uid || '';
  if ($('addDriverBtn')) $('addDriverBtn').textContent = 'Mettre à jour';
  if ($('cancelDriverEditBtn')) $('cancelDriverEditBtn').classList.remove('hidden');
  if ($('driverPanelTitle')) $('driverPanelTitle').textContent = 'Modifier le chauffeur';
  switchAdminTab('panelDrivers');
}
window.editDriver = editDriver;

async function approveDriver(requestId) {
  if (!requireAdmin()) return;
  const req = driverRequests.find(r => r.id === requestId);
  if (!req) return;
  try {
    await db.collection('driverRequests').doc(requestId).update({ status: 'approved', approvedAt: now() });
    await db.collection('users').doc(req.uid).set({ email: req.email || '', name: req.name || '', role: 'driver', active: true, updatedAt: now() }, { merge: true });
    await db.collection('drivers').add({ name: req.name || req.email, email: req.email || '', uid: req.uid, phone: '', active: true, createdAt: now(), updatedAt: now() });
    toastOk('Chauffeur validé ! ✅');
  } catch (e) { toastErr(e.message); }
}
window.approveDriver = approveDriver;

async function rejectDriver(requestId) {
  if (!requireAdmin()) return;
  try {
    await db.collection('driverRequests').doc(requestId).update({ status: 'rejected', updatedAt: now() });
    toastWarn('Demande refusée.');
  } catch (e) { toastErr(e.message); }
}
window.rejectDriver = rejectDriver;

// ═══════════════════════════════════════════
// RESET EDIT
// ═══════════════════════════════════════════
function resetEdit(type) {
  if (type === 'line' || !type) {
    editingLineId = null;
    if ($('lineNameInput')) $('lineNameInput').value = '';
    if ($('lineColor')) $('lineColor').value = '#1a56db';
    if ($('addLineBtn')) $('addLineBtn').textContent = 'Ajouter la ligne';
    if ($('cancelLineEditBtn')) $('cancelLineEditBtn').classList.add('hidden');
    if ($('linePanelTitle')) $('linePanelTitle').textContent = 'Ajouter une ligne';
    setText('lineStatus', '');
  }
  if (type === 'stop' || !type) {
    editingStopId = null;
    if ($('stopName')) $('stopName').value = '';
    if ($('stopLat')) $('stopLat').value = '';
    if ($('stopLng')) $('stopLng').value = '';
    if ($('stopOrder')) $('stopOrder').value = '';
    if ($('addStopBtn')) $('addStopBtn').textContent = 'Ajouter l\'arrêt';
    if ($('cancelStopEditBtn')) $('cancelStopEditBtn').classList.add('hidden');
    if ($('stopPanelTitle')) $('stopPanelTitle').textContent = 'Ajouter un arrêt';
    setText('stopStatus', '');
  }
  if (type === 'vehicle' || !type) {
    editingVehicleId = null;
    if ($('vehicleName')) $('vehicleName').value = '';
    if ($('addVehicleBtn')) $('addVehicleBtn').textContent = 'Ajouter le véhicule';
    if ($('cancelVehicleEditBtn')) $('cancelVehicleEditBtn').classList.add('hidden');
    if ($('vehiclePanelTitle')) $('vehiclePanelTitle').textContent = 'Ajouter un véhicule';
    setText('vehicleStatus', '');
  }
  if (type === 'driver' || !type) {
    editingDriverId = null;
    if ($('driverNameAdmin')) $('driverNameAdmin').value = '';
    if ($('driverPhoneAdmin')) $('driverPhoneAdmin').value = '';
    if ($('driverEmailAdmin')) $('driverEmailAdmin').value = '';
    if ($('addDriverBtn')) $('addDriverBtn').textContent = 'Ajouter le chauffeur';
    if ($('cancelDriverEditBtn')) $('cancelDriverEditBtn').classList.add('hidden');
    if ($('driverPanelTitle')) $('driverPanelTitle').textContent = 'Ajouter un chauffeur';
    setText('driverAdminStatus', '');
  }
}

// ═══════════════════════════════════════════
// DRIVER GPS
// ═══════════════════════════════════════════
function isDriverApproved() { return currentUser && userRole === 'driver'; }
function isAdminRole() { return userRole === 'admin'; }

function currentDriverVehicle() {
  const vid = val('driverVehicleSelect');
  return vehicles.find(v => v.id === vid) || null;
}

function renderDriverWorkStatus() {
  const v = currentDriverVehicle();
  const badge = $('driverWorkBadge');
  const speedBadge = $('driverSpeedBadge');
  if (!badge) return;
  if (!v || v.status !== 'online') {
    badge.className = 'workBadge workBadge--offline';
    badge.innerHTML = '<span class="workBadgeDot"></span> Hors ligne';
    if (speedBadge) speedBadge.classList.add('hidden');
    return;
  }
  const c = computeVisibility(v);
  if (c.visible) {
    badge.className = 'workBadge workBadge--online';
    badge.innerHTML = '<span class="workBadgeDot"></span> En ligne · Visible';
  } else {
    badge.className = 'workBadge workBadge--warning';
    badge.innerHTML = '<span class="workBadgeDot"></span> En ligne · Hors zone';
  }
  if (speedBadge && v.speedKmh != null) {
    speedBadge.textContent = `${v.speedKmh} km/h`;
    speedBadge.classList.remove('hidden');
  }
  // Next stop info
  updateNextStop(v);
}

function updateNextStop(v) {
  const card = $('nextStopCard');
  const info = $('nextStopInfo');
  if (!card || !info) return;
  if (!v || v.status !== 'online' || num(v.lat) === null) { card.classList.add('hidden'); return; }
  const lineStops = stopsForLine(v.lineId);
  if (!lineStops.length) { card.classList.add('hidden'); return; }
  const sorted = lineStops.map(s => ({ s, d: distanceVehicleToStop(v, s) })).sort((a, b) => a.d - b.d);
  const nearest = sorted[0];
  if (!nearest) { card.classList.add('hidden'); return; }
  const distText = nearest.d >= 1000 ? (nearest.d / 1000).toFixed(1) + ' km' : Math.round(nearest.d) + ' m';
  const eta = Math.max(1, Math.round((nearest.d / (ETA_BUS_KMH * 1000 / 3600)) / 60));
  info.innerHTML = `<strong>${nearest.s.name}</strong> · ${distText} · ~${eta} min`;
  card.classList.remove('hidden');
}

function estimateSpeedKmh(vehicle) {
  if (!vehicle._prevLat) return 0;
  const d = distanceMeters(vehicle._prevLat, vehicle._prevLng, num(vehicle.lat), num(vehicle.lng));
  return Math.round((d / 30) * 3.6); // assume 30s interval
}

async function goOnline() {
  if (!isDriverApproved() && !isAdminRole()) {
    toastErr('Compte chauffeur non approuvé.');
    return;
  }
  if (!currentUser) { toastErr('Connecte-toi d\'abord.'); return; }
  const vehicleId = val('driverVehicleSelect');
  if (!vehicleId) { toastErr('Choisis un véhicule.'); return; }
  const v = currentDriverVehicle();
  if (!v) { toastErr('Véhicule introuvable.'); return; }
  setText('driverStatus', 'Démarrage GPS...');
  if (driverWatchId) navigator.geolocation.clearWatch(driverWatchId);
  await db.collection('vehicles').doc(vehicleId).set({
    status: 'online', direction: val('driverDirectionSelect') || 'aller',
    started: false, driverId: currentUser.uid,
    driverName: val('driverNameInput') || currentUser.email,
    onlineAt: now(), updatedAt: now()
  }, { merge: true });
  let prevLat = null, prevLng = null;
  driverWatchId = navigator.geolocation.watchPosition(async p => {
    const t = Date.now();
    const interval = Number(val('driverGpsFrequency') || 30000);
    if (t - lastGpsWrite < interval) return;
    lastGpsWrite = t;
    const lat = p.coords.latitude, lng = p.coords.longitude;
    let speedKmh = 0;
    if (p.coords.speed && p.coords.speed > 0) speedKmh = Math.round(p.coords.speed * 3.6);
    else if (prevLat !== null) {
      const d = distanceMeters(prevLat, prevLng, lat, lng);
      const secs = (interval / 1000) || 30;
      speedKmh = Math.round((d / secs) * 3.6);
    }
    prevLat = lat; prevLng = lng;
    const temp = { ...v, lat, lng, status: 'online', direction: val('driverDirectionSelect') || 'aller', lastGpsUpdate: t };
    const c = computeVisibility(temp);
    try {
      await db.collection('vehicles').doc(vehicleId).set({
        lat, lng, status: 'online', direction: val('driverDirectionSelect') || 'aller',
        driverId: currentUser.uid, driverName: val('driverNameInput') || currentUser.email,
        lastGpsUpdate: firebase.firestore.Timestamp.fromDate(new Date()),
        speedKmh, updatedAt: now(), visibleToClients: c.visible,
        offRoute: !c.near, distanceFromLineMeters: Math.round(c.distance || 0)
      }, { merge: true });
      setText('driverStatus', c.visible ? '✅ En ligne — visible aux clients' : '⚠️ En ligne — hors zone de ligne');
      renderDriverWorkStatus();
    } catch (e) { toastErr('GPS Firebase: ' + e.message); }
  }, e => {
    setText('driverStatus', 'GPS impossible ou refusé.');
    toastErr('Impossible d\'accéder au GPS.');
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  setText('driverStatus', '✅ En ligne. GPS démarré.');
  renderDriverWorkStatus();
}

async function goOffline() {
  const vehicleId = val('driverVehicleSelect');
  if (driverWatchId) navigator.geolocation.clearWatch(driverWatchId);
  driverWatchId = null;
  if (vehicleId) {
    await db.collection('vehicles').doc(vehicleId).set({ status: 'offline', visibleToClients: false, offRoute: false, offlineAt: now(), updatedAt: now() }, { merge: true });
  }
  setText('driverStatus', 'Hors ligne. Bus caché des clients.');
  renderDriverWorkStatus();
  toastOk('Service terminé.');
}

// ═══════════════════════════════════════════
// INCIDENT REPORTING (Driver)
// ═══════════════════════════════════════════
async function reportIncident() {
  if (!requireAuth()) return;
  const v = currentDriverVehicle();
  const type = val('incidentType') || 'autre';
  const note = val('incidentNote').trim();
  try {
    await db.collection('reports').add({
      type, note: note || null,
      vehicleId: v ? v.id : null,
      vehicleName: v ? v.name : null,
      driverId: currentUser.uid,
      driverName: val('driverNameInput') || currentUser.email,
      lineId: v ? v.lineId : null,
      lineName: v ? getLineName(v.lineId) : null,
      archived: false,
      createdAt: now()
    });
    if ($('incidentNote')) $('incidentNote').value = '';
    toastOk('Incident signalé à l\'admin.');
  } catch (e) { toastErr(e.message); }
}

async function archiveIncident(incidentId) {
  if (!requireAdmin()) return;
  await db.collection('reports').doc(incidentId).update({ archived: true, archivedAt: now() });
  toastOk('Archivé.');
}
window.archiveIncident = archiveIncident;

async function clearAllIncidents() {
  if (!requireAdmin()) return;
  if (!confirm('Archiver tous les incidents actifs ?')) return;
  const batch = db.batch();
  incidents.filter(i => !i.archived).forEach(i => {
    batch.update(db.collection('reports').doc(i.id), { archived: true, archivedAt: now() });
  });
  await batch.commit();
  toastOk('Tous les incidents archivés.');
}

// ═══════════════════════════════════════════
// CLIENT GPS
// ═══════════════════════════════════════════
function getPosition() {
  return new Promise((res, rej) =>
    navigator.geolocation ? navigator.geolocation.getCurrentPosition(
      p => res([p.coords.latitude, p.coords.longitude]), rej,
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
    ) : rej(new Error('GPS non disponible'))
  );
}

async function clientGps() {
  try {
    const [lat, lng] = await getPosition();
    if (!map) { openFullMap(); await new Promise(r => setTimeout(r, 600)); }
    map.setView([lat, lng], 15);
    if (clientMarker) clientMarker.setLatLng([lat, lng]);
    else clientMarker = L.marker([lat, lng], { icon: getMyPosIcon() }).addTo(map).bindPopup('📍 Ma position').openPopup();
  } catch (e) { toastErr('GPS impossible ou refusé.'); }
}

// ═══════════════════════════════════════════
// ROUTE SEARCH (simplified Dijkstra)
// ═══════════════════════════════════════════
const WALK_MAX_METERS = 800;

function sortStopsByRoute(lineStops) {
  // Sort stops along route using nearest-neighbor starting from stop with lowest order
  if (lineStops.length <= 2) return lineStops;
  const sorted = [lineStops.reduce((best, s) => Number(s.order||9999) < Number(best.order||9999) ? s : best, lineStops[0])];
  const remaining = lineStops.filter(s => s.id !== sorted[0].id);
  while (remaining.length) {
    const last = sorted[sorted.length - 1];
    let nearestIdx = 0, nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceMeters(num(last.lat), num(last.lng), num(remaining[i].lat), num(remaining[i].lng));
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    sorted.push(remaining.splice(nearestIdx, 1)[0]);
  }
  return sorted;
}

function buildTransportGraph() {
  const graph = {};
  stops.forEach(s => { if (!graph[s.id]) graph[s.id] = []; });

  lines.filter(l => l.active !== false).forEach(line => {
    const allLineStops = stopsForLine(line.id);
    if (allLineStops.length < 2) return;
    
    // Sort stops along the route geographically
    const ordered = sortStopsByRoute(allLineStops);
    
    // Build edges: each stop connects to the next AND previous (bidirectional travel)
    // Also connect with cumulative distance so Dijkstra can traverse the full line
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i], b = ordered[i + 1];
      const d = distanceMeters(num(a.lat), num(a.lng), num(b.lat), num(b.lng));
      const minutes = (d / (BUS_AVG_KMH * 1000 / 3600)) / 60;
      const cost = minutes + 0.5;
      // Aller direction (forward along route)
      graph[a.id].push({ to: b.id, type: 'bus', lineId: line.id, direction: 'aller', distance: d, minutes, cost });
      // Retour direction (backward along route)
      graph[b.id].push({ to: a.id, type: 'bus', lineId: line.id, direction: 'retour', distance: d, minutes, cost });
    }
  });

  // Walking edges between stops of DIFFERENT lines within walking distance
  const validStops = stops.filter(s => num(s.lat) !== null && num(s.lng) !== null);
  for (let i = 0; i < validStops.length; i++) {
    for (let j = i + 1; j < validStops.length; j++) {
      const a = validStops[i], b = validStops[j];
      if (a.lineId === b.lineId) continue; // same line = use bus edges
      const d = distanceMeters(num(a.lat), num(a.lng), num(b.lat), num(b.lng));
      if (d > WALK_MAX_METERS) continue;
      const minutes = (d / WALK_MPS) / 60;
      const cost = minutes * 1.8 + 4; // walking penalty + transfer penalty
      graph[a.id].push({ to: b.id, type: 'walk', distance: d, minutes, cost });
      graph[b.id].push({ to: a.id, type: 'walk', distance: d, minutes, cost });
    }
  }
  return graph;
}

function dijkstraRoute(startId, endId) {
  const graph = buildTransportGraph();
  const dist = {}, prev = {}, visited = new Set();
  Object.keys(graph).forEach(k => { dist[k] = Infinity; });
  dist[startId] = 0;
  const pq = [{ id: startId, cost: 0 }];
  while (pq.length) {
    pq.sort((a, b) => a.cost - b.cost);
    const { id } = pq.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === endId) break;
    (graph[id] || []).forEach(edge => {
      const newCost = dist[id] + edge.cost;
      if (newCost < (dist[edge.to] || Infinity)) {
        dist[edge.to] = newCost;
        prev[edge.to] = { from: id, edge };
        pq.push({ id: edge.to, cost: newCost });
      }
    });
  }
  if (dist[endId] === Infinity) return null;
  const path = [];
  let cur = endId;
  while (cur && prev[cur]) {
    path.unshift({ stopId: cur, ...prev[cur] });
    cur = prev[cur].from;
  }
  return path;
}

function normalize(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
}

function bestStopMatch(query) {
  const q = normalize(query);
  if (!q) return null;
  const qWords = q.split(/\s+/).filter(Boolean);
  
  const scored = stops.map(s => {
    const name = normalize(s.name);
    let score = 0;
    if (name === q) score = 1000;
    else if (name.startsWith(q)) score = 900;
    else if (name.includes(q)) score = 700;
    else {
      // Word-by-word match: "Gare Routiere" matches "Gare Routière de Béjaïa"
      const nameWords = name.split(/\s+/).filter(Boolean);
      const matchedWords = qWords.filter(w => nameWords.some(nw => nw.startsWith(w) || w.startsWith(nw)));
      if (matchedWords.length === qWords.length) score = 600;
      else if (matchedWords.length > 0) score = 300 * (matchedWords.length / qWords.length);
    }
    return { s, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  
  return scored[0]?.s || null;
}

async function searchRouteMultiLines() {
  const fromQ = val('fromInput').trim(), toQ = val('toInput').trim();
  const resultCard = $('routeResultCard');
  const resultEl = $('routeResult');
  const stepsEl = $('routeStepsList');
  if (!fromQ || !toQ) { toastWarn('Remplis départ et destination.'); return; }
  if (resultEl) resultEl.textContent = 'Calcul en cours...';
  if (resultCard) resultCard.classList.remove('hidden');
  const fromStop = bestStopMatch(fromQ), toStop = bestStopMatch(toQ);
  if (!fromStop) { if (resultEl) resultEl.textContent = `Arrêt de départ introuvable: "${fromQ}"`; return; }
  if (!toStop) { if (resultEl) resultEl.textContent = `Destination introuvable: "${toQ}"`; return; }
  if (fromStop.id === toStop.id) { if (resultEl) resultEl.textContent = 'Départ = Destination.'; return; }
  const path = dijkstraRoute(fromStop.id, toStop.id);
  if (!path || !path.length) {
    // Diagnostic: are they on the same line?
    const fromLine = fromStop.lineId, toLine = toStop.lineId;
    let msg = 'Aucun itinéraire trouvé entre ces deux arrêts.';
    if (fromLine && fromLine === toLine) {
      msg = `Les deux arrêts sont sur la même ligne (${getLineName(fromLine)}) mais aucun chemin n'a été trouvé. Vérifiez que les arrêts ont des coordonnées GPS et un ordre défini.`;
    } else if (!fromLine || !toLine) {
      msg = 'Un des arrêts n\'a pas de ligne assignée. Vérifiez les données dans l\'admin.';
    } else {
      msg = `Pas de connexion trouvée entre ${getLineName(fromLine)} et ${getLineName(toLine)}. Les lignes sont peut-être trop éloignées pour une correspondance à pied (max 800m).`;
    }
    if (resultEl) resultEl.innerHTML = `<span style="color:#dc2626">⚠️ ${msg}</span>`;
    return;
  }
  // Build segments
  const segments = [];
  let curSeg = null;
  path.forEach(step => {
    if (step.edge.type === 'bus') {
      if (curSeg && curSeg.type === 'bus' && curSeg.lineId === step.edge.lineId && curSeg.direction === step.edge.direction) {
        curSeg.to = step.stopId;
        curSeg.minutes += step.edge.minutes;
        curSeg.distance += step.edge.distance;
      } else {
        if (curSeg) segments.push(curSeg);
        curSeg = { type: 'bus', lineId: step.edge.lineId, direction: step.edge.direction, from: step.from, to: step.stopId, minutes: step.edge.minutes, distance: step.edge.distance };
      }
    } else {
      if (curSeg) segments.push(curSeg);
      curSeg = { type: 'walk', from: step.from, to: step.stopId, minutes: step.edge.minutes, distance: step.edge.distance };
    }
  });
  if (curSeg) segments.push(curSeg);
  const totalMin = Math.round(segments.reduce((t, s) => t + s.minutes, 0));
  const transfers = segments.filter(s => s.type === 'bus').length - 1;
  if (resultEl) resultEl.innerHTML = `<strong>${fromStop.name}</strong> → <strong>${toStop.name}</strong> · ${totalMin} min · ${transfers > 0 ? transfers + ' correspondance(s)' : 'Direct'}`;
  // Render steps
  if (stepsEl) {
    const stopName = id => stops.find(s => s.id === id)?.name || id;
    const lineColor = id => getLineById(id)?.color || '#1a56db';
    stepsEl.innerHTML = segments.map(seg => {
      if (seg.type === 'bus') {
        const min = Math.max(1, Math.round(seg.minutes));
        return `<div class="routeStepCard busStep">
          <div class="stepIcon">🚌</div>
          <div class="stepContent">
            <div class="stepTitle">Monter à <b>${stopName(seg.from)}</b></div>
            <div class="stepLine"><span class="lineBadge" style="background:${lineColor(seg.lineId)}">${getLineName(seg.lineId)}</span> <span class="directionBadge">${directionLabel(seg.direction)}</span></div>
            <div class="stepMeta">Descendre à <b>${stopName(seg.to)}</b> · ${min} min</div>
          </div>
        </div>`;
      } else {
        const min = Math.max(1, Math.round(seg.minutes));
        const dist = Math.round(seg.distance);
        return `<div class="routeStepCard walkStep">
          <div class="stepIcon">🚶</div>
          <div class="stepContent">
            <div class="stepTitle">Marcher depuis <b>${stopName(seg.from)}</b></div>
            <div class="stepMeta">Jusqu'à <b>${stopName(seg.to)}</b> · ${dist}m · ${min} min</div>
          </div>
        </div>`;
      }
    }).join('');
  }
  // Draw on map
  routeFocusActive = true;
  if (!map) { openFullMap(); await new Promise(r => setTimeout(r, 600)); }
  map.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Polyline || l instanceof L.CircleMarker) map.removeLayer(l); });
  clearRouteLayers();
  const pts = [];
  for (const seg of segments) {
    const fromS = stops.find(s => s.id === seg.from);
    const toS = stops.find(s => s.id === seg.to);
    if (!fromS || !toS) continue;
    pts.push([num(fromS.lat), num(fromS.lng)]);
    pts.push([num(toS.lat), num(toS.lng)]);
    const color = seg.type === 'bus' ? (getLineById(seg.lineId)?.color || '#1a56db') : '#9ca3af';
    const line = L.polyline([[num(fromS.lat), num(fromS.lng)], [num(toS.lat), num(toS.lng)]], { color, weight: seg.type === 'bus' ? 5 : 3, dashArray: seg.type === 'walk' ? '6,6' : null, opacity: 0.85 }).addTo(map);
    routeLayers.push(line);
  }
  // Markers for start/end
  if (pts.length) {
    L.circleMarker(pts[0], { radius: 9, color: '#1a56db', fillColor: '#1a56db', fillOpacity: 1 }).addTo(map).bindPopup('Départ: ' + fromStop.name);
    L.circleMarker(pts[pts.length - 1], { radius: 9, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 }).addTo(map).bindPopup('Arrivée: ' + toStop.name);
    map.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
  }
  saveRecentTrip(fromQ, toQ);
}

function resetRouteSearchView() {
  routeFocusActive = false;
  if ($('routeResultCard')) $('routeResultCard').classList.add('hidden');
  if ($('routeResult')) $('routeResult').innerHTML = '';
  if ($('routeStepsList')) $('routeStepsList').innerHTML = '';
  clearRouteLayers();
  drawMap().catch(console.error);
}

// ═══════════════════════════════════════════
// RECENT TRIPS
// ═══════════════════════════════════════════
function loadRecentTrips() {
  try { return JSON.parse(localStorage.getItem('dz_recentTrips') || '[]'); } catch (e) { return []; }
}

function saveRecentTrip(from, to) {
  if (!from || !to) return;
  const trips = loadRecentTrips().filter(t => !(t.from === from && t.to === to));
  trips.unshift({ from, to, ts: Date.now() });
  localStorage.setItem('dz_recentTrips', JSON.stringify(trips.slice(0, 5)));
  renderRecentTrips();
}

function renderRecentTrips() {
  const box = $('recentTripsBox');
  if (!box) return;
  const trips = loadRecentTrips();
  if (!trips.length) { box.innerHTML = ''; return; }
  box.innerHTML = trips.map(t => `
    <div class="recentTripItem" onclick="useRecentTrip('${t.from}','${t.to}')">
      🕐 ${t.from} → ${t.to}
    </div>`).join('');
}

window.useRecentTrip = function (from, to) {
  if ($('fromInput')) $('fromInput').value = from;
  if ($('toInput')) $('toInput').value = to;
};

// ═══════════════════════════════════════════
// SUGGESTION BOX (Client search)
// ═══════════════════════════════════════════
function setupRouteSuggestions() {
  function suggestFor(inputId, boxId) {
    const input = $(inputId);
    if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const box = $(boxId);
      if (!box) return;
      if (!q) { box.classList.add('hidden'); return; }
      const matches = stops.filter(s => {
        const name = (s.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return name.includes(q);
      }).slice(0, 8);
      if (!matches.length) { box.classList.add('hidden'); return; }
      box.innerHTML = matches.map(s => `
        <div class="suggestionItem" onclick="document.getElementById('${inputId}').value='${s.name.replace(/'/g, "\\'")}';document.getElementById('${boxId}').classList.add('hidden')">
          <div><strong>${s.name}</strong><small>${getLineName(s.lineId)}</small></div>
        </div>`).join('');
      box.classList.remove('hidden');
    });
    input.addEventListener('focus', () => { if ($('recentTripsBox')) renderRecentTrips(); });
    document.addEventListener('click', e => {
      const box = $(boxId);
      if (box && !e.target.closest(`#${inputId}`) && !e.target.closest(`#${boxId}`)) box.classList.add('hidden');
    });
  }
  suggestFor('fromInput', 'routeSuggestionBox');
  suggestFor('toInput', 'routeSuggestionBox');

  // Input clear buttons
  const addClear = (inputId, clearBtnId) => {
    const input = $(inputId), btn = $(clearBtnId);
    if (!input || !btn) return;
    input.addEventListener('input', () => btn.classList.toggle('hidden', !input.value));
    btn.addEventListener('click', () => { input.value = ''; btn.classList.add('hidden'); input.focus(); });
  };
  addClear('fromInput', 'clearFromBtn');
  addClear('toInput', 'clearToBtn');
}

// ═══════════════════════════════════════════
// MAP SEARCH (fullscreen overlay)
// ═══════════════════════════════════════════
function setupMapSearch() {
  const input = $('mapSearchInput');
  const box = $('mapSearchSuggestions');
  const clearBtn = $('mapSearchClearBtn');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (clearBtn) clearBtn.classList.toggle('hidden', !input.value);
    if (!box) return;
    if (!q) { box.classList.add('hidden'); return; }
    const matches = stops.filter(s => (s.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)).slice(0, 6);
    if (!matches.length) { box.classList.add('hidden'); return; }
    box.innerHTML = matches.map(s => `
      <div class="suggestionItem" data-lat="${s.lat}" data-lng="${s.lng}" data-name="${s.name}">
        <div><strong>${s.name}</strong><small>${getLineName(s.lineId)}</small></div>
      </div>`).join('');
    box.querySelectorAll('.suggestionItem').forEach(item => {
      item.addEventListener('click', () => {
        const lat = parseFloat(item.dataset.lat), lng = parseFloat(item.dataset.lng);
        if (map && !isNaN(lat)) { map.setView([lat, lng], 16); }
        input.value = item.dataset.name;
        box.classList.add('hidden');
      });
    });
    box.classList.remove('hidden');
  });
  if (clearBtn) clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.classList.add('hidden'); if (box) box.classList.add('hidden'); });
  if ($('mapLocateBtn')) $('mapLocateBtn').addEventListener('click', async () => {
    try { const [lat, lng] = await getPosition(); if (map) { map.setView([lat, lng], 15); } } catch (e) { toastErr('GPS impossible.'); }
  });
  if ($('mapRefreshBtn')) $('mapRefreshBtn').addEventListener('click', () => { drawMap().catch(console.error); });
  if ($('mapCloseBtn')) $('mapCloseBtn').addEventListener('click', closeFullMap);
  if ($('mapItineraryBtn')) $('mapItineraryBtn').addEventListener('click', () => {
    if ($('mapItineraryPanel')) $('mapItineraryPanel').classList.toggle('hidden');
    if ($('mapInfoSheet')) $('mapInfoSheet').classList.toggle('hidden');
  });
  if ($('mapGoBtn')) $('mapGoBtn').addEventListener('click', () => {
    const from = val('mapFromInput'), to = val('mapToInput');
    if ($('fromInput')) $('fromInput').value = from;
    if ($('toInput')) $('toInput').value = to;
    closeFullMap();
    searchRouteMultiLines();
  });
}

// ═══════════════════════════════════════════
// STOP PICKER
// ═══════════════════════════════════════════
function initStopPicker() {
  if (stopPickerMap) return;
  stopPickerMap = L.map('stopPickerMap').setView([36.7525, 5.0843], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(stopPickerMap);
  stopPickerMap.on('click', e => setPicked(e.latlng.lat, e.latlng.lng));
}

function setPicked(lat, lng) {
  pickedLat = lat; pickedLng = lng;
  if (stopPickerMarker) stopPickerMarker.setLatLng([lat, lng]);
  else { stopPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(stopPickerMap); stopPickerMarker.on('dragend', () => { const p = stopPickerMarker.getLatLng(); setPicked(p.lat, p.lng); }); }
  setText('pickedCoords', `Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`);
}

function openStopPicker() {
  $('stopPickerModal').classList.remove('hidden');
  setTimeout(() => {
    initStopPicker();
    const lat = num(val('stopLat')) || 36.7525, lng = num(val('stopLng')) || 5.0843;
    stopPickerMap.invalidateSize();
    stopPickerMap.setView([lat, lng], 14);
    setPicked(lat, lng);
  }, 180);
}

// ═══════════════════════════════════════════
// GeoJSON / IMPORT
// ═══════════════════════════════════════════
async function loadBejaiaLinesStopsGeojson() {
  try {
    const res = await fetch('./data/bejaia-lines-stops.geojson?v=1');
    if (!res.ok) throw new Error('Fichier GeoJSON introuvable');
    bejaiaGeojson = await res.json();
    setText('bejaiaGeojsonStatus', 'GeoJSON Béjaïa chargé ✅');
  } catch (e) { setText('bejaiaGeojsonStatus', 'Erreur: ' + (e.message || e)); }
}

async function loadOsmStopsGeojson() {
  try {
    const res = await fetch('./data/algeria-osm-stops.geojson?v=1');
    if (!res.ok) throw new Error('Fichier OSM introuvable');
    osmStopsGeojson = await res.json();
    setText('osmImportStatus', 'GeoJSON OSM chargé ✅');
  } catch (e) { setText('osmImportStatus', 'Erreur: ' + (e.message || e)); }
}

async function importBejaiaAutoLinesAndStops() {
  if (!requireAdmin()) return;
  if (!bejaiaGeojson) await loadBejaiaLinesStopsGeojson();
  if (!bejaiaGeojson) { toastErr('GeoJSON non chargé'); return; }
  const features = bejaiaGeojson.features || [];
  const btn = $('autoImportBejaiaBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Import...'; }
  try {
    let linesCreated = 0, stopsCreated = 0;
    // Create lines from route features
    const routeFeatures = features.filter(f => { const p = f.properties || {}; return p.route === 'bus' || p.type === 'route' || ['LineString', 'MultiLineString'].includes((f.geometry || {}).type); });
    const lineIdMap = {};
    for (const f of routeFeatures) {
      const p = f.properties || {};
      const name = p.name || p.ref || ('Ligne OSM ' + (linesCreated + 1));
      const ref = await db.collection('lines').add({ name, city: 'Bejaia', type: 'bus', color: `hsl(${(linesCreated * 47) % 360},70%,45%)`, active: true, source: 'bejaia_osm', osmId: p['@id'] || '', createdAt: now(), updatedAt: now() });
      lineIdMap[f.id || p['@id'] || name] = ref.id;
      linesCreated++;
    }
    // Create stops from point features - assign to nearest line by geography
    const pointFeatures = features.filter(f => f.geometry && f.geometry.type === 'Point');
    // Build line geometries for nearest-line assignment
    const lineGeoms = {};
    features.filter(f => {
      const g = (f.geometry || {}).type;
      return g === 'LineString' || g === 'MultiLineString';
    }).forEach(f => {
      const osmId = (f.properties || {})['@id'] || f.id || '';
      const lid = lineIdMap[osmId] || lineIdMap[f.id] || Object.values(lineIdMap)[0];
      if (!lid) return;
      let coords = [];
      if (f.geometry.type === 'LineString') coords = f.geometry.coordinates;
      else if (f.geometry.type === 'MultiLineString') coords = f.geometry.coordinates.flat();
      lineGeoms[lid] = (lineGeoms[lid] || []).concat(coords);
    });
    const lineIds = Object.keys(lineGeoms);
    
    function distToLine(lat, lng, lineCoords) {
      let minD = Infinity;
      for (const c of lineCoords) {
        const d = Math.hypot(lat - Number(c[1]), lng - Number(c[0]));
        if (d < minD) minD = d;
      }
      return minD;
    }
    
    for (const f of pointFeatures) {
      const p = f.properties || {}, c = f.geometry.coordinates || [];
      const name = p.name || p.local_ref || p.ref || 'Arrêt OSM';
      const lat = Number(c[1]), lng = Number(c[0]);
      
      // Assign to nearest line
      let bestLineId = Object.values(lineIdMap)[0] || '';
      if (lineIds.length > 1) {
        let bestDist = Infinity;
        for (const lid of lineIds) {
          const d = distToLine(lat, lng, lineGeoms[lid] || []);
          if (d < bestDist) { bestDist = d; bestLineId = lid; }
        }
      }
      
      await db.collection('stops').add({ name, lineId: bestLineId, lineName: getLineName(bestLineId), city: 'Bejaia', lat, lng, order: stopsCreated + 1, direction: 'both', active: true, source: 'bejaia_osm', createdAt: now(), updatedAt: now() });
      stopsCreated++;
      if (stopsCreated % 20 === 0) setText('bejaiaGeojsonStatus', `Import... ${stopsCreated} arrêts`);
    }
    setText('bejaiaGeojsonStatus', `✅ Import terminé — ${linesCreated} lignes, ${stopsCreated} arrêts`);
    toastOk(`Import terminé: ${linesCreated} lignes, ${stopsCreated} arrêts`);
  } catch (e) {
    toastErr('Erreur import: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬆️ Importer tout (lignes + arrêts)'; }
  }
}

async function importOsmStopsToFirebase() {
  if (!requireAdmin()) return;
  if (!osmStopsGeojson) await loadOsmStopsGeojson();
  const lineId = val('osmImportLineSelect');
  if (!lineId) { toastErr('Choisir une ligne'); return; }
  const features = (osmStopsGeojson.features || []).filter(f => f.geometry && f.geometry.type === 'Point');
  if (!features.length) { toastErr('Aucun arrêt dans le GeoJSON'); return; }
  const btn = $('importOsmStopsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Import...'; }
  try {
    let count = 0;
    for (const f of features) {
      const p = f.properties || {}, c = f.geometry.coordinates || [];
      await db.collection('stops').add({ name: p.name || p.local_ref || p.ref || 'Arrêt OSM', lineId, lineName: getLineName(lineId), city: getLineById(lineId)?.city || 'Algerie', lat: Number(c[1]), lng: Number(c[0]), order: count + 1, direction: 'both', active: true, source: 'osm_geojson', createdAt: now(), updatedAt: now() });
      count++;
      if (count % 20 === 0) setText('osmImportStatus', `Import... ${count}/${features.length}`);
    }
    setText('osmImportStatus', `✅ ${count} arrêts importés`);
    toastOk(`${count} arrêts OSM importés`);
  } catch (e) { toastErr(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Importer dans Firebase'; } }
}

async function deleteAllLinesAndStops() {
  if (!requireAdmin()) return;
  if (!confirm('⚠️ Supprimer TOUTES les lignes et TOUS les arrêts ? Cette action est irréversible.')) return;
  const batch1 = db.batch();
  (await db.collection('lines').get()).docs.forEach(d => batch1.delete(d.ref));
  await batch1.commit();
  const batch2 = db.batch();
  (await db.collection('stops').get()).docs.forEach(d => batch2.delete(d.ref));
  await batch2.commit();
  toastOk('Toutes les lignes et arrêts supprimés.');
}

function loadExampleImport() {
  const example = { lines: [{ name: 'Tidjounane — Gare', city: 'Bejaia', type: 'bus', color: '#1a56db', stops: [{ name: 'Tidjounane', lat: 36.7501, lng: 5.0601 }, { name: 'Marché central', lat: 36.7520, lng: 5.0720 }, { name: 'Gare routière', lat: 36.7545, lng: 5.0855 }] }] };
  if ($('importJsonText')) $('importJsonText').value = JSON.stringify(example, null, 2);
}

async function importAlgeriaLines() {
  if (!requireAdmin()) return;
  const raw = val('importJsonText');
  let data;
  try { data = JSON.parse(raw); } catch (e) { toastErr('JSON invalide: ' + e.message); return; }
  if (!data.lines || !Array.isArray(data.lines)) { toastErr('Format attendu: {"lines":[...]}'); return; }
  const btn = $('importLinesBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Import...'; }
  try {
    let linesCount = 0, stopsCount = 0;
    for (const lineData of data.lines) {
      const lineRef = await db.collection('lines').add({ name: lineData.name || 'Ligne', city: lineData.city || 'Bejaia', type: lineData.type || 'bus', color: lineData.color || '#1a56db', active: true, createdAt: now(), updatedAt: now() });
      linesCount++;
      if (Array.isArray(lineData.stops)) {
        let order = 1;
        for (const s of lineData.stops) {
          await db.collection('stops').add({ name: s.name, lineId: lineRef.id, lineName: lineData.name, city: lineData.city || 'Bejaia', lat: s.lat, lng: s.lng, order: order++, direction: 'both', active: true, createdAt: now(), updatedAt: now() });
          stopsCount++;
        }
      }
    }
    setText('importStatus', `✅ ${linesCount} ligne(s) · ${stopsCount} arrêt(s)`);
    toastOk(`Import: ${linesCount} lignes, ${stopsCount} arrêts`);
  } catch (e) { toastErr('Erreur import: ' + (e.message || e)); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Importer dans Firebase'; } }
}

// ═══════════════════════════════════════════
// WALKING TRACKS
// ═══════════════════════════════════════════
function walkingTrackDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  return total;
}

function startWalkingTrack() {
  const fromId = val('walkFromStopSelect'), toId = val('walkToStopSelect');
  if (!fromId || !toId || fromId === toId) { toastErr('Choisis deux arrêts différents.'); return; }
  if (!navigator.geolocation) { toastErr('GPS non disponible.'); return; }
  walkingTrackPoints = []; walkingTrackStart = Date.now();
  if (walkingTrackWatchId) navigator.geolocation.clearWatch(walkingTrackWatchId);
  setText('walkingTrackStatus', 'Enregistrement...');
  walkingTrackWatchId = navigator.geolocation.watchPosition(pos => {
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
    const last = walkingTrackPoints[walkingTrackPoints.length - 1];
    if (!last || distanceMeters(last.lat, last.lng, p.lat, p.lng) > 5) {
      walkingTrackPoints.push(p);
      setText('walkingTrackStatus', `${walkingTrackPoints.length} points GPS enregistrés...`);
    }
  }, () => { toastErr('GPS impossible.'); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 });
}

async function stopWalkingTrack() {
  if (walkingTrackWatchId) navigator.geolocation.clearWatch(walkingTrackWatchId);
  walkingTrackWatchId = null;
  const fromId = val('walkFromStopSelect'), toId = val('walkToStopSelect');
  if (!fromId || !toId || fromId === toId) { toastErr('Arrêts invalides.'); return; }
  if (walkingTrackPoints.length < 2) { toastErr('Pas assez de points GPS.'); return; }
  const fromStop = stops.find(s => s.id === fromId), toStop = stops.find(s => s.id === toId);
  try {
    await db.collection('walkingTracks').add({ fromStopId: fromId, toStopId: toId, fromStopName: fromStop?.name || '', toStopName: toStop?.name || '', points: walkingTrackPoints, distanceMeters: Math.round(walkingTrackDistance(walkingTrackPoints)), durationSeconds: Math.round((Date.now() - walkingTrackStart) / 1000), approved: false, active: false, createdBy: currentUser?.uid || 'unknown', createdAt: now() });
    setText('walkingTrackStatus', '✅ Chemin enregistré, en attente de validation admin.');
    walkingTrackPoints = [];
    toastOk('Chemin à pied enregistré.');
  } catch (e) { toastErr(e.message); }
}

// ═══════════════════════════════════════════
// SETUP EVENTS
// ═══════════════════════════════════════════
function setupEvents() {
  // Nav
  document.querySelectorAll('.navBtn').forEach(btn => btn.addEventListener('click', () => {
    switchPage(btn.dataset.page.replace('Page', ''));
  }));
  document.querySelectorAll('.adminTab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.adminTab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.adminPanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = $(btn.dataset.panel);
    if (panel) panel.classList.add('active');
  }));
  // Login modal
  if ($('openLoginBtn')) $('openLoginBtn').addEventListener('click', () => $('loginModal').classList.remove('hidden'));
  if ($('closeLoginBtn')) $('closeLoginBtn').addEventListener('click', () => $('loginModal').classList.add('hidden'));
  if ($('loginBtn')) $('loginBtn').addEventListener('click', async () => {
    try {
      setText('authStatus', 'Connexion...');
      const cred = await auth.signInWithEmailAndPassword(val('emailInput').trim(), val('passwordInput'));
      currentUser = cred.user; await loadRole();
      $('loginModal').classList.add('hidden');
      toastOk('Connecté.');
    } catch (e) { setText('authStatus', e.message || 'Erreur'); }
  });
  if ($('signupBtn')) $('signupBtn').addEventListener('click', async () => {
    try {
      const cred = await auth.createUserWithEmailAndPassword(val('emailInput').trim(), val('passwordInput'));
      await createUserProfileAfterSignup(cred.user, val('signupRoleSelect') || 'client');
      currentUser = cred.user; await loadRole();
      $('loginModal').classList.add('hidden');
      toastOk('Compte créé.');
    } catch (e) { setText('authStatus', e.message || 'Erreur'); }
  });
  if ($('logoutBtn')) $('logoutBtn').addEventListener('click', async () => {
    await goOffline().catch(() => {});
    await auth.signOut();
    window._guestMode = false; currentUser = null;
    renderAuth();
    $('loginModal').classList.add('hidden');
    toastOk('Déconnecté.');
  });
  // Client page
  if ($('searchRouteBtn')) $('searchRouteBtn').addEventListener('click', () => searchRouteMultiLines().catch(e => { toastErr('Erreur itinéraire: ' + e.message); }));
  if ($('clearRouteBtn')) $('clearRouteBtn').addEventListener('click', resetRouteSearchView);
  if ($('openFullMapBtn')) $('openFullMapBtn').addEventListener('click', openFullMap);
  if ($('clientGpsBtn')) $('clientGpsBtn').addEventListener('click', clientGps);
  if ($('clientLineSelect')) $('clientLineSelect').addEventListener('change', renderAll);
  if ($('clientCity')) $('clientCity').addEventListener('change', renderAll);
  if ($('etaRefreshBtn')) $('etaRefreshBtn').addEventListener('click', renderEta);
  if ($('etaStopSelect')) $('etaStopSelect').addEventListener('change', renderEta);
  // Driver
  if ($('goOnlineBtn')) $('goOnlineBtn').addEventListener('click', goOnline);
  if ($('goOfflineBtn')) $('goOfflineBtn').addEventListener('click', goOffline);
  if ($('driverVehicleSelect')) $('driverVehicleSelect').addEventListener('change', renderDriverWorkStatus);
  if ($('reportIncidentBtn')) $('reportIncidentBtn').addEventListener('click', reportIncident);
  // Admin
  if ($('addLineBtn')) $('addLineBtn').addEventListener('click', saveLine);
  if ($('cancelLineEditBtn')) $('cancelLineEditBtn').addEventListener('click', () => resetEdit('line'));
  if ($('addStopBtn')) $('addStopBtn').addEventListener('click', saveStop);
  if ($('cancelStopEditBtn')) $('cancelStopEditBtn').addEventListener('click', () => resetEdit('stop'));
  if ($('addVehicleBtn')) $('addVehicleBtn').addEventListener('click', saveVehicle);
  if ($('cancelVehicleEditBtn')) $('cancelVehicleEditBtn').addEventListener('click', () => resetEdit('vehicle'));
  if ($('addDriverBtn')) $('addDriverBtn').addEventListener('click', saveDriver);
  if ($('cancelDriverEditBtn')) $('cancelDriverEditBtn').addEventListener('click', () => resetEdit('driver'));
  if ($('adminStopsLineFilter')) $('adminStopsLineFilter').addEventListener('change', renderLists);
  if ($('adminStopsSearch')) $('adminStopsSearch').addEventListener('input', renderLists);
  if ($('importLinesBtn')) $('importLinesBtn').addEventListener('click', importAlgeriaLines);
  if ($('loadExampleImportBtn')) $('loadExampleImportBtn').addEventListener('click', loadExampleImport);
  if ($('autoImportBejaiaBtn')) $('autoImportBejaiaBtn').addEventListener('click', importBejaiaAutoLinesAndStops);
  if ($('deleteAllLinesStopsBtn')) $('deleteAllLinesStopsBtn').addEventListener('click', deleteAllLinesAndStops);
  if ($('importOsmStopsBtn')) $('importOsmStopsBtn').addEventListener('click', importOsmStopsToFirebase);
  if ($('showBejaiaGeojsonToggle')) $('showBejaiaGeojsonToggle').addEventListener('change', renderAll);
  if ($('showOsmStopsToggle')) $('showOsmStopsToggle').addEventListener('change', renderAll);
  if ($('clearOldIncidentsBtn')) $('clearOldIncidentsBtn').addEventListener('click', clearAllIncidents);
  // Stop picker
  if ($('pickStopOnMapBtn')) $('pickStopOnMapBtn').addEventListener('click', openStopPicker);
  if ($('pickerCloseBtn')) $('pickerCloseBtn').addEventListener('click', () => $('stopPickerModal').classList.add('hidden'));
  if ($('pickerUseGpsBtn')) $('pickerUseGpsBtn').addEventListener('click', async () => {
    try { const [lat, lng] = await getPosition(); initStopPicker(); stopPickerMap.setView([lat, lng], 16); setPicked(lat, lng); } catch (e) { toastErr('GPS impossible.'); }
  });
  if ($('pickerConfirmBtn')) $('pickerConfirmBtn').addEventListener('click', () => {
    if (pickedLat == null) { toastErr('Choisis une position.'); return; }
    if ($('stopLat')) $('stopLat').value = pickedLat.toFixed(6);
    if ($('stopLng')) $('stopLng').value = pickedLng.toFixed(6);
    $('stopPickerModal').classList.add('hidden');
  });
  if ($('useMyLocationStopBtn')) $('useMyLocationStopBtn').addEventListener('click', async () => {
    try { const [lat, lng] = await getPosition(); if ($('stopLat')) $('stopLat').value = lat.toFixed(6); if ($('stopLng')) $('stopLng').value = lng.toFixed(6); } catch (e) { toastErr('GPS impossible.'); }
  });
  // Walking tracks
  if ($('startWalkingTrackBtn')) $('startWalkingTrackBtn').addEventListener('click', startWalkingTrack);
  if ($('stopWalkingTrackBtn')) $('stopWalkingTrackBtn').addEventListener('click', stopWalkingTrack);
  // Auth gate
  setupAuthGateEvents();
  // Map search
  setupMapSearch();
  // Route suggestions
  setupRouteSuggestions();
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
function init() {
  setFirebaseStatus(true);
  setupEvents();
  renderRecentTrips();
  loadBejaiaLinesStopsGeojson();
  loadOsmStopsGeojson();
  auth.onAuthStateChanged(async user => {
    currentUser = user;
    await loadRole();
    refreshAuthGate();
    if (user) { openRoleHome(); }
    bindRealtime();
  });
}

window.addEventListener('load', init);

})();
