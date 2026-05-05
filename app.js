(function(){
  const $ = id => document.getElementById(id);

  let currentUser = null;
  let currentRole = "guest";
  let lines = [];
  let stops = [];
  let vehicles = [];
  let unsub = [];
  let map = null;
  let stopPickerMap = null;
  let stopPickerMarker = null;
  let pickedLat = null;
  let pickedLng = null;
  let driverWatchId = null;
  let lastGpsWrite = 0;
  let clientLocationMarker = null;
  let clientCentered = false;

  function setText(id, text){ const el=$(id); if(el) el.textContent=text; }
  function val(id){ const el=$(id); return el ? el.value : ""; }
  function num(v){ const x=Number(v); return Number.isFinite(x) ? x : null; }
  function lineName(id){ const l=lines.find(x=>x.id===id); return l ? (l.name || l.id) : (id || ""); }

  function firebaseError(e, statusId){
    console.error("FIRESTORE ERROR", e);
    const msg = "Erreur Firebase: " + (e && e.code ? e.code + " - " : "") + (e && e.message ? e.message : e);
    setText(statusId, msg);
    alert(msg);
  }

  async function addToFirestore(collectionName, data, statusId){
    if(!window.db){
      const msg = "Firebase Firestore n'est pas chargé.";
      setText(statusId, msg);
      alert(msg);
      return null;
    }
    try{
      const ref = await window.db.collection(collectionName).add(data);
      setText(statusId, "Enregistré dans Firebase ✅ ID: " + ref.id);
      return ref;
    }catch(e){
      firebaseError(e, statusId);
      return null;
    }
  }

  function setFirebaseStatus(ok, text){
    const el=$("firebaseStatus");
    if(!el) return;
    el.textContent=text;
    el.className="badge " + (ok ? "green" : "blue");
  }

  function setAuthUi(){
    const btn=$("openLoginBtn");
    if(currentUser){
      btn.textContent="Connecté";
      btn.className="badge green";
      setText("authStatus", `Connecté: ${currentUser.email} · rôle: ${currentRole}`);
    }else{
      btn.textContent="Connexion";
      btn.className="badge light";
      setText("authStatus", "Non connecté");
    }
  }

  function authError(e){
    console.error("AUTH ERROR", e);
    let msg = e && e.message ? e.message : "Erreur connexion.";
    if(e && e.code === "auth/invalid-credential") msg = "Email ou mot de passe incorrect.";
    if(e && e.code === "auth/wrong-password") msg = "Mot de passe incorrect.";
    if(e && e.code === "auth/user-not-found") msg = "Compte introuvable dans Firebase Authentication.";
    if(e && e.code === "auth/operation-not-allowed") msg = "Active Email/Password dans Firebase Authentication.";
    if(e && e.code === "auth/unauthorized-domain") msg = "Domaine GitHub non autorisé dans Firebase Authentication.";
    if(e && e.code === "auth/network-request-failed") msg = "Problème réseau Firebase.";
    setText("authStatus", msg);
    alert(msg);
  }

  async function loadRole(){
    currentRole = "guest";
    if(!currentUser || !window.db){ setAuthUi(); return; }

    const email = (currentUser.email || "").toLowerCase();
    const uid = currentUser.uid;

    if(email === "allaouaboucheneb04@gmail.com"){
      currentRole = "admin";
      setAuthUi();
      return;
    }

    try{
      const adminSnap = await window.db.collection("admins").doc(uid).get();
      if(adminSnap.exists && (adminSnap.data().active === true || adminSnap.data().role === "admin")){
        currentRole = "admin";
        setAuthUi();
        return;
      }

      const userSnap = await window.db.collection("users").doc(uid).get();
      if(userSnap.exists){
        currentRole = userSnap.data().role || "driver";
        setAuthUi();
        return;
      }

      await window.db.collection("users").doc(uid).set({
        email: currentUser.email,
        role: "driver",
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});

      currentRole = "driver";
    }catch(e){
      console.error("ROLE ERROR", e);
      currentRole = email === "allaouaboucheneb04@gmail.com" ? "admin" : "driver";
    }

    setAuthUi();
  }

  function requireAdmin(){
    if(!currentUser){ alert("Connecte-toi d’abord."); return false; }
    if(currentRole !== "admin"){ alert("Compte admin requis."); return false; }
    return true;
  }

  function initMap(){
    if(map || !$("map")) return;
    map = L.map("map").setView([36.7525, 5.0843], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution:"© OpenStreetMap" }).addTo(map);
  }

  function bindRealtime(){
    if(!window.db) return;
    unsub.forEach(fn => fn && fn());
    unsub = [];

    unsub.push(window.db.collection("lines").onSnapshot(s => {
      lines = s.docs.map(d => ({id:d.id, ...d.data()}));
      renderAll();
    }, e => console.error("lines", e)));

    unsub.push(window.db.collection("stops").onSnapshot(s => {
      stops = s.docs.map(d => ({id:d.id, ...d.data()}));
      renderAll();
    }, e => console.error("stops", e)));

    unsub.push(window.db.collection("vehicles").onSnapshot(s => {
      vehicles = s.docs.map(d => ({id:d.id, ...d.data()}));
      renderAll();
    }, e => console.error("vehicles", e)));
  }

  function renderSelects(){
    const city = val("clientCity") || "Bejaia";
    const visibleLines = lines.filter(l => !l.city || l.city === city || city === "all");

    const clientLine = $("clientLineSelect");
    if(clientLine){
      const old = clientLine.value || "all";
      clientLine.innerHTML = '<option value="all">Toutes les lignes</option>' +
        visibleLines.map(l => `<option value="${l.id}">${l.name || l.id}</option>`).join("");
      clientLine.value = Array.from(clientLine.options).some(o=>o.value===old) ? old : "all";
    }

    const lineOpts = lines.map(l => `<option value="${l.id}">${l.name || l.id}</option>`).join("");
    ["stopLineSelect","vehicleLineSelect"].forEach(id => { if($(id)) $(id).innerHTML = lineOpts; });

    const vehOpts = vehicles.map(v => `<option value="${v.id}">${v.name || v.id}</option>`).join("");
    if($("driverVehicleSelect")) $("driverVehicleSelect").innerHTML = vehOpts;
  }

  function renderLists(){
    const selectedLine = val("clientLineSelect") || "all";
    const visibleStops = stops.filter(s => selectedLine === "all" || s.lineId === selectedLine || s.line === selectedLine);

    $("stopsList").innerHTML = visibleStops.length ? visibleStops.map(s => `
      <div class="item">
        <strong>🚏 ${s.name || "Arrêt"}</strong>
        <span class="muted">${lineName(s.lineId)} · ${s.lat ?? s.latitude ?? ""}, ${s.lng ?? s.longitude ?? ""}</span>
      </div>`).join("") : '<div class="muted">Aucun arrêt.</div>';

    $("vehiclesList").innerHTML = vehicles.length ? vehicles.map(v => `
      <div class="item">
        <strong>🚌 ${v.name || "Véhicule"}</strong>
        <span class="muted">${lineName(v.lineId)} · ${v.status || "inactif"} · ${v.lat ? "GPS OK" : "pas de GPS"}</span>
      </div>`).join("") : '<div class="muted">Aucun véhicule.</div>';

    $("linesAdminList").innerHTML = lines.length ? lines.map(l => `
      <div class="item">
        <strong>${l.name || l.id}</strong>
        <span class="muted">${l.city || ""} · ${l.type || "bus"}</span>
        <button class="deleteBtn" type="button" data-del-line="${l.id}">Supprimer</button>
      </div>`).join("") : '<div class="muted">Aucune ligne.</div>';

    $("stopsAdminList").innerHTML = stops.length ? stops.map(s => `
      <div class="item">
        <strong>${s.name || s.id}</strong>
        <span class="muted">${lineName(s.lineId)} · ${s.lat ?? s.latitude ?? ""}, ${s.lng ?? s.longitude ?? ""}</span>
        <button class="deleteBtn" type="button" data-del-stop="${s.id}">Supprimer</button>
      </div>`).join("") : '<div class="muted">Aucun arrêt.</div>';

    $("vehiclesAdminList").innerHTML = vehicles.length ? vehicles.map(v => `
      <div class="item">
        <strong>${v.name || v.id}</strong>
        <span class="muted">${lineName(v.lineId)} · chauffeur: ${v.driverId || ""}</span>
        <button class="deleteBtn" type="button" data-del-veh="${v.id}">Supprimer</button>
      </div>`).join("") : '<div class="muted">Aucun véhicule.</div>';

    document.querySelectorAll("[data-del-line]").forEach(b => b.onclick = () => requireAdmin() && window.db.collection("lines").doc(b.dataset.delLine).delete());
    document.querySelectorAll("[data-del-stop]").forEach(b => b.onclick = () => requireAdmin() && window.db.collection("stops").doc(b.dataset.delStop).delete());
    document.querySelectorAll("[data-del-veh]").forEach(b => b.onclick = () => requireAdmin() && window.db.collection("vehicles").doc(b.dataset.delVeh).delete());
  }

  function drawMap(){
    if(!map) return;

    map.eachLayer(layer => {
      if(layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polyline){
        map.removeLayer(layer);
      }
    });

    const selectedLine = val("clientLineSelect") || "all";
    const visibleStops = stops.filter(s => {
      const lat = num(s.lat ?? s.latitude);
      const lng = num(s.lng ?? s.longitude);
      return lat !== null && lng !== null && (selectedLine === "all" || s.lineId === selectedLine || s.line === selectedLine);
    });

    const lineGroups = {};
    visibleStops.forEach(s => {
      const lat = num(s.lat ?? s.latitude);
      const lng = num(s.lng ?? s.longitude);
      const color = lines.find(l => l.id === s.lineId)?.color || "#2563eb";
      L.circleMarker([lat,lng], {radius:8, color, fillColor:color, weight:3, fillOpacity:.9})
        .addTo(map)
        .bindPopup(`🚏 ${s.name || "Arrêt"}<br>${lineName(s.lineId)}`);

      if(s.lineId){
        if(!lineGroups[s.lineId]) lineGroups[s.lineId] = [];
        lineGroups[s.lineId].push([lat,lng]);
      }
    });

    Object.keys(lineGroups).forEach(lineId => {
      const pts = lineGroups[lineId];
      if(pts.length > 1){
        const color = lines.find(l => l.id === lineId)?.color || "#2563eb";
        L.polyline(pts, {color, weight:4, opacity:.55}).addTo(map);
      }
    });

    vehicles.forEach(v => {
      const lat = num(v.lat);
      const lng = num(v.lng);
      if(lat === null || lng === null) return;
      L.marker([lat,lng]).addTo(map).bindPopup(`🚌 ${v.name || "Véhicule"}<br>${lineName(v.lineId)}<br>${v.status || ""}`);
    });

    if(clientLocationMarker) clientLocationMarker.addTo(map);

    if(!clientCentered){
      const pts = [
        ...visibleStops.map(s => [num(s.lat ?? s.latitude), num(s.lng ?? s.longitude)]),
        ...vehicles.map(v => [num(v.lat), num(v.lng)]).filter(p => p[0] !== null && p[1] !== null)
      ];
      if(pts.length) map.fitBounds(pts, {padding:[30,30], maxZoom:14});
    }
  }

  function renderAll(){
    renderSelects();
    renderLists();
    drawMap();
  }

  function clientGps(){
    if(!navigator.geolocation) return alert("GPS non disponible.");
    setText("routeResult", "Recherche de ta position...");
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      clientCentered = true;
      map.setView([lat,lng], 16);
      if(clientLocationMarker) clientLocationMarker.setLatLng([lat,lng]);
      else clientLocationMarker = L.circleMarker([lat,lng], {radius:10, weight:3, fillOpacity:.85}).addTo(map);
      clientLocationMarker.bindPopup("📍 Ma position").openPopup();
      setText("routeResult", "Carte centrée sur ta position.");
    }, e => {
      let msg = "GPS impossible.";
      if(e.code === 1) msg = "GPS refusé. Autorise la position pour Safari.";
      if(e.code === 2) msg = "Position indisponible. Active Wi-Fi + données cellulaires.";
      if(e.code === 3) msg = "GPS trop long. Essaie dehors ou près d’une fenêtre.";
      setText("routeResult", msg);
      alert(msg);
    }, {enableHighAccuracy:false, timeout:20000, maximumAge:60000});
  }

  function getPosition(){
    return new Promise((resolve,reject) => {
      if(!navigator.geolocation) return reject(new Error("GPS non disponible"));
      navigator.geolocation.getCurrentPosition(p => resolve([p.coords.latitude,p.coords.longitude]), reject, {
        enableHighAccuracy:false,
        timeout:20000,
        maximumAge:60000
      });
    });
  }

  function initStopPicker(){
    if(stopPickerMap) return;
    stopPickerMap = L.map("stopPickerMap").setView([36.7525,5.0843],13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {attribution:"© OpenStreetMap"}).addTo(stopPickerMap);
    stopPickerMap.on("click", e => setPicked(e.latlng.lat,e.latlng.lng));
  }

  function setPicked(lat,lng){
    pickedLat = lat;
    pickedLng = lng;
    if(stopPickerMarker) stopPickerMarker.setLatLng([lat,lng]);
    else{
      stopPickerMarker = L.marker([lat,lng], {draggable:true}).addTo(stopPickerMap);
      stopPickerMarker.on("dragend", () => {
        const p = stopPickerMarker.getLatLng();
        setPicked(p.lat,p.lng);
      });
    }
    setText("pickedCoords", `Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`);
  }

  function openStopPicker(){
    $("stopPickerModal").classList.remove("hidden");
    setTimeout(() => {
      initStopPicker();
      const lat = num(val("stopLat")) || 36.7525;
      const lng = num(val("stopLng")) || 5.0843;
      stopPickerMap.invalidateSize();
      stopPickerMap.setView([lat,lng], 14);
      setPicked(lat,lng);
    }, 180);
  }

  async function saveLine(){
    if(!requireAdmin()) return;
    const btn = $("addLineBtn");
    if(btn) { btn.disabled = true; btn.textContent = "Enregistrement..."; }

    const name = val("lineName").trim();
    if(!name){
      if(btn) { btn.disabled = false; btn.textContent = "Ajouter ligne"; }
      return alert("Nom de ligne obligatoire.");
    }

    const ref = await addToFirestore("lines", {
      city: val("lineCity") || "Bejaia",
      name,
      type: val("lineType") || "bus",
      color: val("lineColor") || "#2563eb",
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, "lineStatus");

    if(ref){
      $("lineName").value = "";
    }

    if(btn) { btn.disabled = false; btn.textContent = "Ajouter ligne"; }
  }

  async function saveStop(){
    if(!requireAdmin()) return;
    const btn = $("addStopBtn");
    if(btn) { btn.disabled = true; btn.textContent = "Enregistrement..."; }

    const name = val("stopName").trim();
    const lat = num(val("stopLat"));
    const lng = num(val("stopLng"));

    if(!name){
      if(btn) { btn.disabled = false; btn.textContent = "Ajouter arrêt"; }
      return alert("Nom arrêt obligatoire.");
    }
    if(lat === null || lng === null){
      if(btn) { btn.disabled = false; btn.textContent = "Ajouter arrêt"; }
      return alert("Latitude/longitude invalide.");
    }

    const ref = await addToFirestore("stops", {
      lineId: val("stopLineSelect"),
      name,
      lat,
      lng,
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, "stopStatus");

    if(ref){
      $("stopName").value = "";
      $("stopLat").value = "";
      $("stopLng").value = "";
    }

    if(btn) { btn.disabled = false; btn.textContent = "Ajouter arrêt"; }
  }

  async function saveVehicle(){
    if(!requireAdmin()) return;
    const btn = $("addVehicleBtn");
    if(btn) { btn.disabled = true; btn.textContent = "Enregistrement..."; }

    const name = val("vehicleName").trim();
    if(!name){
      if(btn) { btn.disabled = false; btn.textContent = "Ajouter véhicule"; }
      return alert("Nom véhicule obligatoire.");
    }

    const ref = await addToFirestore("vehicles", {
      name,
      lineId: val("vehicleLineSelect"),
      driverId: val("vehicleDriverId").trim(),
      status: "inactive",
      lat: null,
      lng: null,
      updatedAt: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, "vehicleStatus");

    if(ref){
      $("vehicleName").value = "";
      $("vehicleDriverId").value = "";
    }

    if(btn) { btn.disabled = false; btn.textContent = "Ajouter véhicule"; }
  }

  function startDriverGps(){
    if(!currentUser) return alert("Connecte-toi comme chauffeur.");
    const vehicleId = val("driverVehicleSelect");
    if(!vehicleId) return alert("Choisis un véhicule.");
    const interval = Number(val("driverGpsFrequency") || 30000);

    if(driverWatchId) navigator.geolocation.clearWatch(driverWatchId);

    driverWatchId = navigator.geolocation.watchPosition(async p => {
      const now = Date.now();
      if(now - lastGpsWrite < interval) return;
      lastGpsWrite = now;

      await window.db.collection("vehicles").doc(vehicleId).set({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        driverId: currentUser.uid,
        driverName: val("driverNameInput") || currentUser.email,
        status: "active",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});

      setText("driverStatus", "GPS envoyé: " + new Date().toLocaleTimeString());
    }, e => {
      alert("GPS chauffeur impossible.");
    }, {enableHighAccuracy:false, timeout:20000, maximumAge:10000});

    setText("driverStatus", "GPS démarré.");
  }

  function stopDriverGps(){
    if(driverWatchId) navigator.geolocation.clearWatch(driverWatchId);
    driverWatchId = null;
    setText("driverStatus", "GPS arrêté.");
  }

  async function seedData(city){
    if(!requireAdmin()) return;

    const isMtl = city === "Montreal";
    const lineRef = await window.db.collection("lines").add({
      city,
      name: isMtl ? "Test Montréal" : "Tidjounane",
      type: "bus",
      color: isMtl ? "#16a34a" : "#2563eb",
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const demoStops = isMtl ? [
      ["Jean-Talon",45.5390,-73.6130],
      ["Saint-Michel",45.5590,-73.5990],
      ["Pie-IX",45.5530,-73.5510]
    ] : [
      ["Béjaïa Centre",36.7525,5.0843],
      ["Gare routière",36.7509,5.0567],
      ["Université",36.7165,5.0614],
      ["Sidi Aïch",36.6122,4.6865]
    ];

    for(const s of demoStops){
      await window.db.collection("stops").add({
        lineId: lineRef.id,
        name: s[0],
        lat: s[1],
        lng: s[2],
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    await window.db.collection("vehicles").add({
      name: isMtl ? "Bus test Montréal" : "Bus Tidjounane 01",
      lineId: lineRef.id,
      driverId: "",
      status: "inactive",
      lat: demoStops[0][1],
      lng: demoStops[0][2],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert("Données démo ajoutées ✅");
  }

  function setupEvents(){
    $("openLoginBtn").onclick = () => $("loginModal").classList.remove("hidden");
    $("closeLoginBtn").onclick = () => $("loginModal").classList.add("hidden");

    $("loginBtn").onclick = async () => {
      const email = val("emailInput").trim();
      const pass = val("passwordInput");
      if(!email || !pass) return alert("Mets ton email et ton mot de passe.");

      $("loginBtn").disabled = true;
      $("loginBtn").textContent = "Connexion...";
      setText("authStatus", "Connexion en cours...");

      const slowTimer = setTimeout(() => {
        setText("authStatus", "Connexion lente. Vérifie Email/Password et Authorized domains.");
      }, 7000);

      try{
        const cred = await window.auth.signInWithEmailAndPassword(email, pass);
        clearTimeout(slowTimer);
        currentUser = cred.user;
        await loadRole();
        $("loginModal").classList.add("hidden");
        alert("Connexion réussie ✅");
      }catch(e){
        clearTimeout(slowTimer);
        authError(e);
      }finally{
        $("loginBtn").disabled = false;
        $("loginBtn").textContent = "Se connecter";
      }
    };

    $("signupBtn").onclick = async () => {
      try{
        const cred = await window.auth.createUserWithEmailAndPassword(val("emailInput").trim(), val("passwordInput"));
        currentUser = cred.user;
        await loadRole();
        alert("Compte créé ✅");
      }catch(e){ authError(e); }
    };

    $("logoutBtn").onclick = async () => {
      await window.auth.signOut();
      currentUser = null;
      currentRole = "guest";
      setAuthUi();
    };

    document.querySelectorAll(".navBtn").forEach(btn => btn.onclick = () => {
      document.querySelectorAll(".navBtn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.page).classList.add("active");
      setTimeout(() => map && map.invalidateSize(), 250);
    });

    document.querySelectorAll(".tab").forEach(btn => btn.onclick = () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".adminPanel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.panel).classList.add("active");
    });

    $("clientGpsBtn").onclick = clientGps;
    $("clientLineSelect").onchange = () => { clientCentered = false; renderAll(); };
    $("clientCity").onchange = () => { clientCentered = false; renderAll(); };

    $("searchRouteBtn").onclick = () => {
      const q = (val("fromInput") + " " + val("toInput")).trim().toLowerCase();
      const hits = stops.filter(s => (s.name || "").toLowerCase().includes(q));
      setText("routeResult", hits.length ? `${hits.length} arrêt(s) trouvé(s).` : "Aucun trajet automatique pour le moment.");
    };

    $("addLineBtn").onclick = saveLine;
    $("addStopBtn").onclick = saveStop;
    $("addVehicleBtn").onclick = saveVehicle;

    $("useMyLocationStopBtn").onclick = async () => {
      try{
        const [lat,lng] = await getPosition();
        $("stopLat").value = lat.toFixed(6);
        $("stopLng").value = lng.toFixed(6);
      }catch(e){
        alert("GPS impossible.");
      }
    };

    $("pickStopOnMapBtn").onclick = openStopPicker;
    $("pickerCloseBtn").onclick = () => $("stopPickerModal").classList.add("hidden");
    $("pickerUseGpsBtn").onclick = async () => {
      try{
        const [lat,lng] = await getPosition();
        initStopPicker();
        stopPickerMap.setView([lat,lng],16);
        setPicked(lat,lng);
      }catch(e){ alert("GPS impossible."); }
    };
    $("pickerConfirmBtn").onclick = () => {
      if(pickedLat == null) return alert("Choisis une position.");
      $("stopLat").value = pickedLat.toFixed(6);
      $("stopLng").value = pickedLng.toFixed(6);
      $("stopPickerModal").classList.add("hidden");
    };

    $("startDriverGpsBtn").onclick = startDriverGps;
    $("stopDriverGpsBtn").onclick = stopDriverGps;

    $("seedBejaiaBtn").onclick = () => seedData("Bejaia");
    $("seedMontrealBtn").onclick = () => seedData("Montreal");
    $("refreshBtn").onclick = () => renderAll();
  }

  function init(){
    if(!window.firebase || !window.auth || !window.db){
      alert("Firebase n'est pas chargé. Vérifie firebase-config.js.");
      return;
    }

    setFirebaseStatus(true, "Firebase connecté");
    initMap();
    setupEvents();

    window.auth.onAuthStateChanged(async user => {
      currentUser = user || null;
      await loadRole();
      bindRealtime();
      renderAll();
    });
  }

  window.addEventListener("load", init);
})();
