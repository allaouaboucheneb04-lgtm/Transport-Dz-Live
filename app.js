
// Transport Live DZ - Auth stable repair
(function(){
  const $ = (id) => document.getElementById(id);
  const qs = (sel) => document.querySelector(sel);

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

  function safeText(id, text){
    const el = $(id);
    if(el) el.textContent = text;
  }

  function safeValue(id){
    const el = $(id);
    return el ? el.value : "";
  }

  function getLoginModal(){
    return $("loginModal") || qs(".modal");
  }

  function getAuthStatus(){
    return $("authStatus") || qs("#loginModal .result") || qs(".modal .result");
  }

  function setAuthStatus(text){
    const el = getAuthStatus();
    if(el) el.textContent = text;
  }

  function getLoginButtonTop(){
    return $("openLoginBtn") || $("loginOpenBtn") || $("loginBtnTop") || qs("button[data-open-login]") || Array.from(document.querySelectorAll("button")).find(b => (b.textContent || "").trim().toLowerCase() === "connexion");
  }

  function setFirebaseStatus(ok, text){
    const el = $("firebaseStatus") || qs(".firebaseStatus") || qs(".firebase-status");
    if(el){
      el.textContent = text;
      el.classList.remove("blue","green","light");
      el.classList.add(ok ? "green" : "blue");
    }
  }

  function setAuthUi(){
    const top = getLoginButtonTop();
    if(top){
      if(currentUser){
        top.textContent = "Connecté";
        top.classList.remove("light","blue");
        top.classList.add("green");
      }else{
        top.textContent = "Connexion";
        top.classList.remove("green","blue");
        top.classList.add("light");
      }
    }

    if(currentUser){
      setAuthStatus("Connecté: " + currentUser.email + " · rôle: " + currentRole);
    }else{
      setAuthStatus("Non connecté");
    }
  }

  function openLogin(){
    const modal = getLoginModal();
    if(modal) modal.classList.remove("hidden");
  }

  function closeLogin(){
    const modal = getLoginModal();
    if(modal) modal.classList.add("hidden");
  }

  function authError(e){
    console.error("AUTH ERROR", e);
    let msg = (e && e.message) ? e.message : "Erreur connexion.";
    if(e && e.code === "auth/invalid-credential") msg = "Email ou mot de passe incorrect.";
    if(e && e.code === "auth/wrong-password") msg = "Mot de passe incorrect.";
    if(e && e.code === "auth/user-not-found") msg = "Compte introuvable dans Firebase Authentication.";
    if(e && e.code === "auth/operation-not-allowed") msg = "Active Email/Password dans Firebase Authentication.";
    if(e && e.code === "auth/unauthorized-domain") msg = "Domaine GitHub non autorisé dans Firebase Authentication.";
    if(e && e.code === "auth/network-request-failed") msg = "Problème réseau Firebase. Réessaie.";
    setAuthStatus(msg);
    alert(msg);
  }

  async function loadRole(){
    currentRole = "guest";
    if(!currentUser || !window.db){
      setAuthUi();
      return;
    }

    const email = (currentUser.email || "").toLowerCase();
    const uid = currentUser.uid;

    // Admin principal garanti dans l'app
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
      // Do not block login if role read fails
      currentRole = email === "allaouaboucheneb04@gmail.com" ? "admin" : "driver";
    }

    setAuthUi();
  }

  function requireAdmin(){
    if(!currentUser){
      alert("Connecte-toi d’abord.");
      return false;
    }
    if(currentRole !== "admin"){
      alert("Compte admin requis.");
      return false;
    }
    return true;
  }

  function n(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function lineName(id){
    const line = lines.find(l => l.id === id);
    return line ? (line.name || line.id) : (id || "");
  }

  function initMap(){
    if(map || !$("map") || typeof L === "undefined") return;
    map = L.map("map").setView([36.7525, 5.0843], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap"
    }).addTo(map);
  }

  function renderSelects(){
    const clientLine = $("clientLineSelect") || $("lineFilter") || $("clientLine");
    if(clientLine){
      const old = clientLine.value || "all";
      clientLine.innerHTML = '<option value="all">Toutes les lignes</option>' + lines.map(l => `<option value="${l.id}">${l.name || l.id}</option>`).join("");
      clientLine.value = Array.from(clientLine.options).some(o => o.value === old) ? old : "all";
    }

    const adminOpts = lines.map(l => `<option value="${l.id}">${l.name || l.id}</option>`).join("");
    ["stopLineSelect","vehicleLineSelect","lineSelect","stopLine","vehicleLine"].forEach(id => {
      const el = $(id);
      if(el) el.innerHTML = adminOpts;
    });

    const vehOpts = vehicles.map(v => `<option value="${v.id}">${v.name || v.id}</option>`).join("");
    const drv = $("driverVehicleSelect") || $("vehicleSelect");
    if(drv) drv.innerHTML = vehOpts;
  }

  function renderLists(){
    const stopsList = $("stopsList");
    if(stopsList){
      stopsList.innerHTML = stops.length ? stops.map(s => `
        <div class="item">
          <strong>🚏 ${s.name || "Arrêt"}</strong>
          <span class="muted">${lineName(s.lineId)} · ${s.lat ?? s.latitude ?? ""}, ${s.lng ?? s.longitude ?? ""}</span>
        </div>
      `).join("") : '<div class="muted">Aucun arrêt.</div>';
    }

    const linesAdmin = $("linesAdminList");
    if(linesAdmin){
      linesAdmin.innerHTML = lines.length ? lines.map(l => `
        <div class="item">
          <strong>${l.name || l.id}</strong>
          <span class="muted">${l.type || "bus"}</span>
          <button class="deleteBtn" data-del-line="${l.id}" type="button">Supprimer</button>
        </div>
      `).join("") : '<div class="muted">Aucune ligne.</div>';
    }

    const stopsAdmin = $("stopsAdminList");
    if(stopsAdmin){
      stopsAdmin.innerHTML = stops.length ? stops.map(s => `
        <div class="item">
          <strong>${s.name || s.id}</strong>
          <span class="muted">${lineName(s.lineId)} · ${s.lat ?? s.latitude ?? ""}, ${s.lng ?? s.longitude ?? ""}</span>
          <button class="deleteBtn" data-del-stop="${s.id}" type="button">Supprimer</button>
        </div>
      `).join("") : '<div class="muted">Aucun arrêt.</div>';
    }

    const vehiclesAdmin = $("vehiclesAdminList");
    if(vehiclesAdmin){
      vehiclesAdmin.innerHTML = vehicles.length ? vehicles.map(v => `
        <div class="item">
          <strong>${v.name || v.id}</strong>
          <span class="muted">${lineName(v.lineId)} · chauffeur: ${v.driverId || ""}</span>
          <button class="deleteBtn" data-del-veh="${v.id}" type="button">Supprimer</button>
        </div>
      `).join("") : '<div class="muted">Aucun véhicule.</div>';
    }

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

    const selectedEl = $("clientLineSelect") || $("lineFilter") || $("clientLine");
    const selected = selectedEl ? selectedEl.value : "all";

    const visibleStops = stops.filter(s => {
      const lat = n(s.lat ?? s.latitude);
      const lng = n(s.lng ?? s.longitude);
      return lat !== null && lng !== null && (selected === "all" || s.lineId === selected || s.line === selected);
    });

    visibleStops.forEach(s => {
      const lat = n(s.lat ?? s.latitude);
      const lng = n(s.lng ?? s.longitude);
      L.circleMarker([lat, lng], {radius:8, weight:3, fillOpacity:.9})
        .addTo(map)
        .bindPopup(`🚏 ${s.name || "Arrêt"}<br>${lineName(s.lineId)}`);
    });

    vehicles.forEach(v => {
      const lat = n(v.lat);
      const lng = n(v.lng);
      if(lat === null || lng === null) return;
      L.marker([lat,lng]).addTo(map).bindPopup(`🚌 ${v.name || "Véhicule"}<br>${lineName(v.lineId)}<br>${v.status || ""}`);
    });

    if(clientLocationMarker) clientLocationMarker.addTo(map);

    if(!clientCentered){
      const pts = [
        ...visibleStops.map(s => [n(s.lat ?? s.latitude), n(s.lng ?? s.longitude)]),
        ...vehicles.map(v => [n(v.lat), n(v.lng)]).filter(p => p[0] !== null && p[1] !== null)
      ];
      if(pts.length) map.fitBounds(pts, {padding:[30,30], maxZoom:14});
    }
  }

  function renderAll(){
    renderSelects();
    renderLists();
    drawMap();
  }

  function bindRealtime(){
    if(!window.db) return;
    unsub.forEach(fn => fn && fn());
    unsub = [];

    unsub.push(window.db.collection("lines").onSnapshot(snap => {
      lines = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderAll();
    }, console.error));

    unsub.push(window.db.collection("stops").onSnapshot(snap => {
      stops = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderAll();
    }, console.error));

    unsub.push(window.db.collection("vehicles").onSnapshot(snap => {
      vehicles = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderAll();
    }, console.error));
  }

  function centerClientManual(){
    if(!navigator.geolocation){
      alert("GPS non disponible.");
      return;
    }
    safeText("routeResult", "Recherche de ta position...");
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      clientCentered = true;
      if(map){
        map.setView([lat,lng],16);
        if(clientLocationMarker) clientLocationMarker.setLatLng([lat,lng]);
        else clientLocationMarker = L.circleMarker([lat,lng], {radius:10, weight:3, fillOpacity:.85}).addTo(map);
        clientLocationMarker.bindPopup("📍 Ma position").openPopup();
      }
      safeText("routeResult", "Carte centrée sur ta position.");
    }, err => {
      let msg = "GPS impossible.";
      if(err.code === 1) msg = "GPS refusé. Autorise la position pour Safari.";
      if(err.code === 2) msg = "Position indisponible. Active Wi‑Fi + données cellulaires.";
      if(err.code === 3) msg = "GPS trop long. Essaie dehors ou près d’une fenêtre.";
      safeText("routeResult", msg);
      alert(msg);
    }, {enableHighAccuracy:false, timeout:20000, maximumAge:60000});
  }

  function getPosition(){
    return new Promise((resolve,reject) => {
      if(!navigator.geolocation) return reject(new Error("GPS non disponible"));
      navigator.geolocation.getCurrentPosition(p => resolve([p.coords.latitude, p.coords.longitude]), reject, {
        enableHighAccuracy:false,
        timeout:20000,
        maximumAge:60000
      });
    });
  }

  function initStopPicker(){
    if(stopPickerMap || !$("stopPickerMap") || typeof L === "undefined") return;
    stopPickerMap = L.map("stopPickerMap").setView([36.7525,5.0843],13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {attribution:"© OpenStreetMap"}).addTo(stopPickerMap);
    stopPickerMap.on("click", e => setPicked(e.latlng.lat, e.latlng.lng));
  }

  function setPicked(lat,lng){
    pickedLat = lat;
    pickedLng = lng;
    if(stopPickerMarker) stopPickerMarker.setLatLng([lat,lng]);
    else if(stopPickerMap){
      stopPickerMarker = L.marker([lat,lng], {draggable:true}).addTo(stopPickerMap);
      stopPickerMarker.on("dragend", () => {
        const p = stopPickerMarker.getLatLng();
        setPicked(p.lat,p.lng);
      });
    }
    safeText("pickedCoords", `Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`);
  }

  function openStopPicker(){
    const modal = $("stopPickerModal") || $("stopMapPickerModal");
    if(!modal) return alert("Carte arrêt introuvable.");
    modal.classList.remove("hidden");

    setTimeout(() => {
      initStopPicker();
      const lat = n(safeValue("stopLat") || safeValue("stopLatitude")) || 36.7525;
      const lng = n(safeValue("stopLng") || safeValue("stopLongitude")) || 5.0843;
      if(stopPickerMap){
        stopPickerMap.invalidateSize();
        stopPickerMap.setView([lat,lng],14);
        setPicked(lat,lng);
      }
    }, 180);
  }

  function setupEvents(){
    const top = getLoginButtonTop();
    if(top) top.onclick = openLogin;

    const close = $("closeLoginBtn") || $("closeLogin") || qs(".modal .ghost");
    if(close) close.onclick = closeLogin;

    const login = $("loginBtn");
    if(login){
      login.onclick = async () => {
        const emailEl = $("emailInput") || qs('input[type="email"]');
        const passEl = $("passwordInput") || qs('input[type="password"]');
        const email = emailEl ? emailEl.value.trim() : "";
        const pass = passEl ? passEl.value : "";

        if(!email || !pass){
          alert("Mets ton email et mot de passe.");
          return;
        }

        setAuthStatus("Connexion en cours...");
        login.disabled = true;
        login.textContent = "Connexion...";

        const slowTimer = setTimeout(() => {
          setAuthStatus("Connexion lente. Vérifie Email/Password activé et domaine autorisé.");
        }, 7000);

        try{
          const cred = await window.auth.signInWithEmailAndPassword(email, pass);
          clearTimeout(slowTimer);
          currentUser = cred.user;
          await loadRole();
          closeLogin();
          alert("Connexion réussie ✅");
        }catch(e){
          clearTimeout(slowTimer);
          authError(e);
        }finally{
          login.disabled = false;
          login.textContent = "Se connecter";
        }
      };
    }

    const signup = $("signupBtn");
    if(signup){
      signup.onclick = async () => {
        const emailEl = $("emailInput") || qs('input[type="email"]');
        const passEl = $("passwordInput") || qs('input[type="password"]');
        try{
          const cred = await window.auth.createUserWithEmailAndPassword(emailEl.value.trim(), passEl.value);
          currentUser = cred.user;
          await loadRole();
          alert("Compte créé ✅");
        }catch(e){ authError(e); }
      };
    }

    const logout = $("logoutBtn");
    if(logout){
      logout.onclick = async () => {
        await window.auth.signOut();
        currentUser = null;
        currentRole = "guest";
        setAuthUi();
      };
    }

    document.querySelectorAll(".navBtn").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll(".navBtn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const page = $(btn.dataset.page);
        if(page) page.classList.add("active");
        setTimeout(() => map && map.invalidateSize(), 250);
      };
    });

    document.querySelectorAll(".tab").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".adminPanel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const panel = $(btn.dataset.panel) || $(btn.dataset.adminTab ? ("admin" + btn.dataset.adminTab[0].toUpperCase() + btn.dataset.adminTab.slice(1)) : "");
        if(panel) panel.classList.add("active");
      };
    });

    const clientGps = $("clientGpsBtn") || $("centerClientGpsBtn");
    if(clientGps) clientGps.onclick = centerClientManual;

    const lineSelect = $("clientLineSelect") || $("lineFilter") || $("clientLine");
    if(lineSelect) lineSelect.onchange = () => { clientCentered = false; renderAll(); };

    const search = $("searchRouteBtn");
    if(search){
      search.onclick = () => {
        const q = ((safeValue("fromInput") || "") + " " + (safeValue("toInput") || "")).trim().toLowerCase();
        const hits = stops.filter(s => (s.name || "").toLowerCase().includes(q));
        safeText("routeResult", hits.length ? `${hits.length} arrêt(s) trouvé(s).` : "Aucun trajet automatique pour le moment.");
      };
    }

    const addLine = $("addLineBtn");
    if(addLine){
      addLine.onclick = async () => {
        if(!requireAdmin()) return;
        await window.db.collection("lines").add({
          name: safeValue("lineName").trim(),
          type: safeValue("lineType") || "bus",
          color: safeValue("lineColor") || "#2563eb",
          active: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if($("lineName")) $("lineName").value = "";
      };
    }

    const useStopGps = $("useMyLocationStopBtn") || $("useMyLocationStop");
    if(useStopGps){
      useStopGps.onclick = async () => {
        try{
          const [lat,lng] = await getPosition();
          if($("stopLat")) $("stopLat").value = lat.toFixed(6);
          if($("stopLng")) $("stopLng").value = lng.toFixed(6);
          if($("stopLatitude")) $("stopLatitude").value = lat.toFixed(6);
          if($("stopLongitude")) $("stopLongitude").value = lng.toFixed(6);
        }catch(e){
          alert("GPS impossible.");
        }
      };
    }

    const pickMap = $("pickStopOnMapBtn") || $("openStopPickerBtn");
    if(pickMap) pickMap.onclick = openStopPicker;

    const pickerClose = $("pickerCloseBtn") || $("closeStopPickerBtn");
    if(pickerClose) pickerClose.onclick = () => {
      const modal = $("stopPickerModal") || $("stopMapPickerModal");
      if(modal) modal.classList.add("hidden");
    };

    const pickerUseGps = $("pickerUseGpsBtn") || $("useMyLocationForStopBtn");
    if(pickerUseGps){
      pickerUseGps.onclick = async () => {
        try{
          const [lat,lng] = await getPosition();
          initStopPicker();
          if(stopPickerMap) stopPickerMap.setView([lat,lng],16);
          setPicked(lat,lng);
        }catch(e){ alert("GPS impossible."); }
      };
    }

    const pickerConfirm = $("pickerConfirmBtn") || $("confirmStopPositionBtn");
    if(pickerConfirm){
      pickerConfirm.onclick = () => {
        if(pickedLat == null) return alert("Choisis une position.");
        if($("stopLat")) $("stopLat").value = pickedLat.toFixed(6);
        if($("stopLng")) $("stopLng").value = pickedLng.toFixed(6);
        if($("stopLatitude")) $("stopLatitude").value = pickedLat.toFixed(6);
        if($("stopLongitude")) $("stopLongitude").value = pickedLng.toFixed(6);
        const modal = $("stopPickerModal") || $("stopMapPickerModal");
        if(modal) modal.classList.add("hidden");
      };
    }

    const addStop = $("addStopBtn");
    if(addStop){
      addStop.onclick = async () => {
        if(!requireAdmin()) return;
        const lat = n(safeValue("stopLat") || safeValue("stopLatitude"));
        const lng = n(safeValue("stopLng") || safeValue("stopLongitude"));
        if(lat === null || lng === null) return alert("Latitude/longitude invalide.");
        await window.db.collection("stops").add({
          lineId: safeValue("stopLineSelect") || safeValue("stopLine") || "",
          name: safeValue("stopName").trim(),
          lat, lng,
          active: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if($("stopName")) $("stopName").value = "";
        if($("stopLat")) $("stopLat").value = "";
        if($("stopLng")) $("stopLng").value = "";
      };
    }

    const addVehicle = $("addVehicleBtn");
    if(addVehicle){
      addVehicle.onclick = async () => {
        if(!requireAdmin()) return;
        await window.db.collection("vehicles").add({
          name: safeValue("vehicleName") || safeValue("vehicleNumber") || "Bus",
          lineId: safeValue("vehicleLineSelect") || "",
          driverId: safeValue("vehicleDriverId") || "",
          status: "active",
          lat: 36.7525,
          lng: 5.0843,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      };
    }

    const startDriver = $("startDriverGpsBtn");
    if(startDriver){
      startDriver.onclick = () => {
        if(!currentUser) return alert("Connecte-toi.");
        const vehicleSelect = $("driverVehicleSelect") || $("vehicleSelect");
        const vehicleId = vehicleSelect ? vehicleSelect.value : "";
        if(!vehicleId) return alert("Choisis un véhicule.");
        if(driverWatchId) navigator.geolocation.clearWatch(driverWatchId);

        driverWatchId = navigator.geolocation.watchPosition(async p => {
          const now = Date.now();
          if(now - lastGpsWrite < 15000) return;
          lastGpsWrite = now;
          await window.db.collection("vehicles").doc(vehicleId).set({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            driverId: currentUser.uid,
            status: "active",
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, {merge:true});
          safeText("driverStatus", "GPS envoyé: " + new Date().toLocaleTimeString());
        }, () => alert("GPS chauffeur impossible"), {enableHighAccuracy:false, timeout:20000, maximumAge:10000});

        safeText("driverStatus", "GPS démarré.");
      };
    }

    const stopDriver = $("stopDriverGpsBtn");
    if(stopDriver){
      stopDriver.onclick = () => {
        if(driverWatchId) navigator.geolocation.clearWatch(driverWatchId);
        driverWatchId = null;
        safeText("driverStatus", "GPS arrêté.");
      };
    }
  }

  function init(){
    if(!window.firebase || !window.auth || !window.db){
      alert("Firebase n'est pas chargé. Vérifie firebase-config.js et les scripts.");
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
