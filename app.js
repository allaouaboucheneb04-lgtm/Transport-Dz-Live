(function(){
  const $ = id => document.getElementById(id);

  let currentUser = null, currentRole = "guest";
  let lines = [], stops = [], vehicles = [], drivers = [], clients = [];
  let unsub = [], map = null, stopPickerMap = null, stopPickerMarker = null;
  let pickedLat = null, pickedLng = null, driverWatchId = null, lastGpsWrite = 0;
  let clientLocationMarker = null, clientCentered = false;

  function setText(id,text){ const el=$(id); if(el) el.textContent=text; }
  function val(id){ const el=$(id); return el ? el.value : ""; }
  function num(v){ const x=Number(v); return Number.isFinite(x) ? x : null; }
  function now(){ return firebase.firestore.FieldValue.serverTimestamp(); }

  async function save(collectionName, data, statusId){
    try{
      if(!window.db) throw new Error("db Firebase non chargé");
      const ref = await window.db.collection(collectionName).add(data);
      if(statusId) setText(statusId, `Enregistré Firebase ✅ ID: ${ref.id}`);
      return ref;
    }catch(e){
      console.error("SAVE ERROR", collectionName, e);
      const msg = `Erreur Firebase ${collectionName}: ${e.code || ""} ${e.message || e}`;
      if(statusId) setText(statusId, msg);
      alert(msg);
      throw e;
    }
  }

  function lineName(id){ const l=lines.find(x=>x.id===id); return l ? (l.name || l.id) : (id || ""); }
  function driverName(id){ const d=drivers.find(x=>x.id===id || x.uid===id || x.email===id); return d ? (d.name || d.email || d.id) : (id || ""); }

  function setFirebaseStatus(ok,text){
    const el=$("firebaseStatus"); if(!el) return;
    el.textContent=text; el.className="badge " + (ok ? "green" : "blue");
  }

  function setAuthUi(){
    const btn=$("openLoginBtn");
    if(currentUser){
      btn.textContent="Connecté"; btn.className="badge green";
      setText("authStatus", `Connecté: ${currentUser.email} · rôle: ${currentRole}`);
    }else{
      btn.textContent="Connexion"; btn.className="badge light"; setText("authStatus","Non connecté");
    }
  }

  function authError(e){
    console.error("AUTH ERROR", e);
    let msg=e?.message || "Erreur connexion.";
    if(e?.code==="auth/invalid-credential") msg="Email ou mot de passe incorrect.";
    if(e?.code==="auth/wrong-password") msg="Mot de passe incorrect.";
    if(e?.code==="auth/user-not-found") msg="Compte introuvable.";
    if(e?.code==="auth/operation-not-allowed") msg="Active Email/Password dans Firebase Authentication.";
    if(e?.code==="auth/unauthorized-domain") msg="Domaine GitHub non autorisé dans Firebase Authentication.";
    setText("authStatus", msg); alert(msg);
  }

  async function loadRole(){
    currentRole="guest";
    if(!currentUser || !window.db){ setAuthUi(); return; }
    const email=(currentUser.email||"").toLowerCase();
    const uid=currentUser.uid;
    if(email==="allaouaboucheneb04@gmail.com"){
      currentRole="admin"; setAuthUi(); return;
    }
    try{
      const adminSnap=await window.db.collection("admins").doc(uid).get();
      if(adminSnap.exists && (adminSnap.data().active===true || adminSnap.data().role==="admin")){
        currentRole="admin"; setAuthUi(); return;
      }
      const userSnap=await window.db.collection("users").doc(uid).get();
      if(userSnap.exists){
        currentRole=userSnap.data().role || "driver"; setAuthUi(); return;
      }
      await window.db.collection("users").doc(uid).set({email:currentUser.email,role:"driver",active:true,createdAt:now()},{merge:true});
      currentRole="driver";
    }catch(e){
      console.error("ROLE ERROR", e);
      currentRole=email==="allaouaboucheneb04@gmail.com" ? "admin" : "driver";
    }
    setAuthUi();
  }

  function requireAdmin(){
    if(!currentUser){ alert("Connecte-toi d’abord."); return false; }
    if(currentRole!=="admin"){ alert("Compte admin requis."); return false; }
    return true;
  }

  function initMap(){
    if(map) return;
    map=L.map("map").setView([36.7525,5.0843],13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map);
  }

  function bindRealtime(){
    unsub.forEach(fn=>fn&&fn()); unsub=[];
    const collections = [
      ["lines", data => { lines=data; }],
      ["stops", data => { stops=data; }],
      ["vehicles", data => { vehicles=data; }],
      ["drivers", data => { drivers=data; }],
      ["clients", data => { clients=data; }]
    ];
    collections.forEach(([name, setter])=>{
      unsub.push(window.db.collection(name).onSnapshot(snap=>{
        setter(snap.docs.map(d=>({id:d.id,...d.data()})));
        renderAll();
      }, e=>console.error("READ ERROR", name, e)));
    });
  }

  function renderSelects(){
    const city=val("clientCity") || "Bejaia";
    const visibleLines=lines.filter(l=>!l.city || l.city===city);
    const clientLine=$("clientLineSelect");
    const old=clientLine.value || "all";
    clientLine.innerHTML='<option value="all">Toutes les lignes</option>'+visibleLines.map(l=>`<option value="${l.id}">${l.name||l.id}</option>`).join("");
    clientLine.value=Array.from(clientLine.options).some(o=>o.value===old)?old:"all";

    const lineOpts=lines.map(l=>`<option value="${l.id}">${l.name||l.id}</option>`).join("");
    $("stopLineSelect").innerHTML=lineOpts;
    $("vehicleLineSelect").innerHTML=lineOpts;

    const driverOpts='<option value="">Aucun chauffeur</option>'+drivers.map(d=>`<option value="${d.id}">${d.name||d.email||d.id}</option>`).join("");
    $("vehicleDriverSelect").innerHTML=driverOpts;

    $("driverVehicleSelect").innerHTML=vehicles.map(v=>`<option value="${v.id}">${v.name||v.id}</option>`).join("");
  }

  function renderLists(){
    const selectedLine=val("clientLineSelect") || "all";
    const visibleStops=stops.filter(s=>selectedLine==="all" || s.lineId===selectedLine);

    $("stopsList").innerHTML=visibleStops.length?visibleStops.map(s=>`<div class="item"><strong>🚏 ${s.name||"Arrêt"}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat??""}, ${s.lng??""}</span></div>`).join(""):'<div class="muted">Aucun arrêt.</div>';
    $("vehiclesList").innerHTML=vehicles.length?vehicles.map(v=>`<div class="item"><strong>🚌 ${v.name||"Véhicule"}</strong><span class="muted">${lineName(v.lineId)} · ${v.status||"inactive"} · ${v.lat?"GPS OK":"pas de GPS"}</span></div>`).join(""):'<div class="muted">Aucun véhicule.</div>';
    $("linesAdminList").innerHTML=lines.length?lines.map(l=>`<div class="item"><strong>${l.name||l.id}</strong><span class="muted">${l.city||""} · ${l.type||"bus"}</span><button class="deleteBtn" data-del-line="${l.id}">Supprimer</button></div>`).join(""):'<div class="muted">Aucune ligne.</div>';
    $("stopsAdminList").innerHTML=stops.length?stops.map(s=>`<div class="item"><strong>${s.name||s.id}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat??""}, ${s.lng??""}</span><button class="deleteBtn" data-del-stop="${s.id}">Supprimer</button></div>`).join(""):'<div class="muted">Aucun arrêt.</div>';
    $("vehiclesAdminList").innerHTML=vehicles.length?vehicles.map(v=>`<div class="item"><strong>${v.name||v.id}</strong><span class="muted">${lineName(v.lineId)} · chauffeur: ${driverName(v.driverId)}</span><button class="deleteBtn" data-del-veh="${v.id}">Supprimer</button></div>`).join(""):'<div class="muted">Aucun véhicule.</div>';
    $("driversAdminList").innerHTML=drivers.length?drivers.map(d=>`<div class="item"><strong>${d.name||d.id}</strong><span class="muted">${d.phone||""} · ${d.email||d.uid||""}</span><button class="deleteBtn" data-del-driver="${d.id}">Supprimer</button></div>`).join(""):'<div class="muted">Aucun chauffeur.</div>';
    $("clientsAdminList").innerHTML=clients.length?clients.map(c=>`<div class="item"><strong>${c.name||c.id}</strong><span class="muted">${c.phone||""} · ${c.email||""}</span><button class="deleteBtn" data-del-client="${c.id}">Supprimer</button></div>`).join(""):'<div class="muted">Aucun client.</div>';

    document.querySelectorAll("[data-del-line]").forEach(b=>b.onclick=()=>requireAdmin()&&window.db.collection("lines").doc(b.dataset.delLine).delete());
    document.querySelectorAll("[data-del-stop]").forEach(b=>b.onclick=()=>requireAdmin()&&window.db.collection("stops").doc(b.dataset.delStop).delete());
    document.querySelectorAll("[data-del-veh]").forEach(b=>b.onclick=()=>requireAdmin()&&window.db.collection("vehicles").doc(b.dataset.delVeh).delete());
    document.querySelectorAll("[data-del-driver]").forEach(b=>b.onclick=()=>requireAdmin()&&window.db.collection("drivers").doc(b.dataset.delDriver).delete());
    document.querySelectorAll("[data-del-client]").forEach(b=>b.onclick=()=>requireAdmin()&&window.db.collection("clients").doc(b.dataset.delClient).delete());
  }

  function drawMap(){
    if(!map) return;
    map.eachLayer(layer=>{ if(layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polyline) map.removeLayer(layer); });
    const selectedLine=val("clientLineSelect") || "all";
    const visibleStops=stops.filter(s=>{
      const lat=num(s.lat), lng=num(s.lng);
      return lat!==null && lng!==null && (selectedLine==="all" || s.lineId===selectedLine);
    });

    const groups={};
    visibleStops.forEach(s=>{
      const lat=num(s.lat), lng=num(s.lng);
      const color=lines.find(l=>l.id===s.lineId)?.color || "#2563eb";
      L.circleMarker([lat,lng],{radius:8,color,fillColor:color,weight:3,fillOpacity:.9}).addTo(map).bindPopup(`🚏 ${s.name||"Arrêt"}<br>${lineName(s.lineId)}`);
      if(s.lineId){ groups[s.lineId]=groups[s.lineId]||[]; groups[s.lineId].push([lat,lng]);}
    });
    Object.keys(groups).forEach(lineId=>{ if(groups[lineId].length>1){ const color=lines.find(l=>l.id===lineId)?.color || "#2563eb"; L.polyline(groups[lineId],{color,weight:4,opacity:.55}).addTo(map); }});
    vehicles.forEach(v=>{ const lat=num(v.lat), lng=num(v.lng); if(lat===null||lng===null)return; L.marker([lat,lng]).addTo(map).bindPopup(`🚌 ${v.name||"Véhicule"}<br>${lineName(v.lineId)}<br>${v.status||""}`); });
    if(clientLocationMarker) clientLocationMarker.addTo(map);
    if(!clientCentered){
      const pts=[...visibleStops.map(s=>[num(s.lat),num(s.lng)]),...vehicles.map(v=>[num(v.lat),num(v.lng)]).filter(p=>p[0]!==null&&p[1]!==null)];
      if(pts.length) map.fitBounds(pts,{padding:[30,30],maxZoom:14});
    }
  }

  function renderAll(){ renderSelects(); renderLists(); drawMap(); }

  function clientGps(){
    if(!navigator.geolocation)return alert("GPS non disponible.");
    setText("routeResult","Recherche de ta position...");
    navigator.geolocation.getCurrentPosition(p=>{
      const lat=p.coords.latitude,lng=p.coords.longitude; clientCentered=true;
      map.setView([lat,lng],16);
      if(clientLocationMarker)clientLocationMarker.setLatLng([lat,lng]);
      else clientLocationMarker=L.circleMarker([lat,lng],{radius:10,weight:3,fillOpacity:.85}).addTo(map);
      clientLocationMarker.bindPopup("📍 Ma position").openPopup();
      setText("routeResult","Carte centrée sur ta position.");
    },e=>{let msg="GPS impossible.";if(e.code===1)msg="GPS refusé.";if(e.code===2)msg="Position indisponible.";if(e.code===3)msg="GPS trop long.";setText("routeResult",msg);alert(msg);},{enableHighAccuracy:false,timeout:20000,maximumAge:60000});
  }

  function getPosition(){
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(new Error("GPS non disponible"));
      navigator.geolocation.getCurrentPosition(p=>resolve([p.coords.latitude,p.coords.longitude]),reject,{enableHighAccuracy:false,timeout:20000,maximumAge:60000});
    });
  }

  function initStopPicker(){
    if(stopPickerMap)return;
    stopPickerMap=L.map("stopPickerMap").setView([36.7525,5.0843],13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(stopPickerMap);
    stopPickerMap.on("click",e=>setPicked(e.latlng.lat,e.latlng.lng));
  }

  function setPicked(lat,lng){
    pickedLat=lat;pickedLng=lng;
    if(stopPickerMarker)stopPickerMarker.setLatLng([lat,lng]);
    else{ stopPickerMarker=L.marker([lat,lng],{draggable:true}).addTo(stopPickerMap); stopPickerMarker.on("dragend",()=>{const p=stopPickerMarker.getLatLng();setPicked(p.lat,p.lng);});}
    setText("pickedCoords",`Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`);
  }

  function openStopPicker(){
    $("stopPickerModal").classList.remove("hidden");
    setTimeout(()=>{ initStopPicker(); const lat=num(val("stopLat"))||36.7525,lng=num(val("stopLng"))||5.0843; stopPickerMap.invalidateSize(); stopPickerMap.setView([lat,lng],14); setPicked(lat,lng);},180);
  }

  async function saveLine(){
    if(!requireAdmin())return;
    const name=val("lineName").trim(); if(!name)return alert("Nom ligne obligatoire.");
    await save("lines",{city:val("lineCity"),name,type:val("lineType"),color:val("lineColor"),active:true,createdAt:now()},"lineStatus");
    $("lineName").value="";
  }

  async function saveStop(){
    if(!requireAdmin())return;
    const name=val("stopName").trim(), lat=num(val("stopLat")), lng=num(val("stopLng"));
    if(!name)return alert("Nom arrêt obligatoire.");
    if(lat===null||lng===null)return alert("Latitude/longitude invalide.");
    await save("stops",{lineId:val("stopLineSelect"),name,lat,lng,active:true,createdAt:now()},"stopStatus");
    $("stopName").value="";$("stopLat").value="";$("stopLng").value="";
  }

  async function saveVehicle(){
    if(!requireAdmin())return;
    const name=val("vehicleName").trim(); if(!name)return alert("Nom véhicule obligatoire.");
    await save("vehicles",{name,lineId:val("vehicleLineSelect"),driverId:val("vehicleDriverSelect"),status:"inactive",lat:null,lng:null,updatedAt:null,createdAt:now()},"vehicleStatus");
    $("vehicleName").value="";
  }

  async function saveDriver(){
    if(!requireAdmin())return;
    const name=val("driverNameAdmin").trim(); if(!name)return alert("Nom chauffeur obligatoire.");
    await save("drivers",{name,phone:val("driverPhoneAdmin").trim(),email:val("driverEmailAdmin").trim(),uid:val("driverEmailAdmin").trim(),active:true,createdAt:now()},"driverAdminStatus");
    $("driverNameAdmin").value="";$("driverPhoneAdmin").value="";$("driverEmailAdmin").value="";
  }

  async function saveClient(){
    if(!requireAdmin())return;
    const name=val("clientNameAdmin").trim(); if(!name)return alert("Nom client obligatoire.");
    await save("clients",{name,phone:val("clientPhoneAdmin").trim(),email:val("clientEmailAdmin").trim(),favoriteStops:[],active:true,createdAt:now()},"clientAdminStatus");
    $("clientNameAdmin").value="";$("clientPhoneAdmin").value="";$("clientEmailAdmin").value="";
  }

  function startDriverGps(){
    if(!currentUser)return alert("Connecte-toi comme chauffeur.");
    const vehicleId=val("driverVehicleSelect"); if(!vehicleId)return alert("Choisis un véhicule.");
    const interval=Number(val("driverGpsFrequency")||30000);
    if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);
    driverWatchId=navigator.geolocation.watchPosition(async p=>{
      const t=Date.now(); if(t-lastGpsWrite<interval)return; lastGpsWrite=t;
      try{
        await window.db.collection("vehicles").doc(vehicleId).set({lat:p.coords.latitude,lng:p.coords.longitude,driverId:currentUser.uid,driverName:val("driverNameInput")||currentUser.email,status:"active",updatedAt:now()},{merge:true});
        setText("driverStatus","GPS envoyé Firebase: "+new Date().toLocaleTimeString());
      }catch(e){ console.error(e); alert("Erreur GPS Firebase: "+e.message); }
    },e=>alert("GPS chauffeur impossible."),{enableHighAccuracy:false,timeout:20000,maximumAge:10000});
    setText("driverStatus","GPS démarré.");
  }

  function stopDriverGps(){ if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId); driverWatchId=null; setText("driverStatus","GPS arrêté."); }

  async function seedData(city){
    if(!requireAdmin())return;
    const demo=city==="Montreal"?{line:"Test Montréal",color:"#16a34a",stops:[["Jean-Talon",45.5390,-73.6130],["Saint-Michel",45.5590,-73.5990],["Pie-IX",45.5530,-73.5510]]}:{line:"Tidjounane",color:"#2563eb",stops:[["Béjaïa Centre",36.7525,5.0843],["Gare routière",36.7509,5.0567],["Université",36.7165,5.0614],["Sidi Aïch",36.6122,4.6865]]};
    const lineRef=await save("lines",{city,name:demo.line,type:"bus",color:demo.color,active:true,createdAt:now()},"toolStatus");
    for(const s of demo.stops){ await save("stops",{lineId:lineRef.id,name:s[0],lat:s[1],lng:s[2],active:true,createdAt:now()},"toolStatus");}
    await save("vehicles",{name:"Bus "+demo.line,lineId:lineRef.id,driverId:"",status:"inactive",lat:demo.stops[0][1],lng:demo.stops[0][2],updatedAt:now(),createdAt:now()},"toolStatus");
    alert("Données démo sauvegardées Firebase ✅");
  }

  function setupEvents(){
    $("openLoginBtn").onclick=()=>$("loginModal").classList.remove("hidden");
    $("closeLoginBtn").onclick=()=>$("loginModal").classList.add("hidden");
    $("loginBtn").onclick=async()=>{
      const email=val("emailInput").trim(), pass=val("passwordInput"); if(!email||!pass)return alert("Mets email et mot de passe.");
      $("loginBtn").disabled=true;$("loginBtn").textContent="Connexion...";setText("authStatus","Connexion en cours...");
      try{const cred=await window.auth.signInWithEmailAndPassword(email,pass);currentUser=cred.user;await loadRole();$("loginModal").classList.add("hidden");alert("Connexion réussie ✅");}catch(e){authError(e);}finally{$("loginBtn").disabled=false;$("loginBtn").textContent="Se connecter";}
    };
    $("signupBtn").onclick=async()=>{try{const cred=await window.auth.createUserWithEmailAndPassword(val("emailInput").trim(),val("passwordInput"));currentUser=cred.user;await loadRole();alert("Compte créé ✅");}catch(e){authError(e);}};
    $("logoutBtn").onclick=async()=>{await window.auth.signOut();currentUser=null;currentRole="guest";setAuthUi();};

    document.querySelectorAll(".navBtn").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".navBtn").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.page).classList.add("active");setTimeout(()=>map&&map.invalidateSize(),250);});
    document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".adminPanel").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.panel).classList.add("active");});

    $("clientGpsBtn").onclick=clientGps;$("clientLineSelect").onchange=()=>{clientCentered=false;renderAll();};$("clientCity").onchange=()=>{clientCentered=false;renderAll();};
    $("searchRouteBtn").onclick=()=>{const q=(val("fromInput")+" "+val("toInput")).trim().toLowerCase();const hits=stops.filter(s=>(s.name||"").toLowerCase().includes(q));setText("routeResult",hits.length?`${hits.length} arrêt(s) trouvé(s).`:"Aucun trajet automatique pour le moment.");};
    $("addLineBtn").onclick=saveLine;$("addStopBtn").onclick=saveStop;$("addVehicleBtn").onclick=saveVehicle;$("addDriverBtn").onclick=saveDriver;$("addClientBtn").onclick=saveClient;
    $("useMyLocationStopBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();$("stopLat").value=lat.toFixed(6);$("stopLng").value=lng.toFixed(6);}catch(e){alert("GPS impossible.");}};
    $("pickStopOnMapBtn").onclick=openStopPicker;$("pickerCloseBtn").onclick=()=>$("stopPickerModal").classList.add("hidden");
    $("pickerUseGpsBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();initStopPicker();stopPickerMap.setView([lat,lng],16);setPicked(lat,lng);}catch(e){alert("GPS impossible.");}};
    $("pickerConfirmBtn").onclick=()=>{if(pickedLat==null)return alert("Choisis une position.");$("stopLat").value=pickedLat.toFixed(6);$("stopLng").value=pickedLng.toFixed(6);$("stopPickerModal").classList.add("hidden");};
    $("startDriverGpsBtn").onclick=startDriverGps;$("stopDriverGpsBtn").onclick=stopDriverGps;
    $("seedBejaiaBtn").onclick=()=>seedData("Bejaia");$("seedMontrealBtn").onclick=()=>seedData("Montreal");$("refreshBtn").onclick=renderAll;
    $("testSaveBtn").onclick=async()=>{if(!requireAdmin())return;await save("testWrites",{message:"test ok",email:currentUser.email,createdAt:now()},"toolStatus");};
  }

  function init(){
    if(!window.firebase||!window.auth||!window.db){alert("Firebase non chargé. Vérifie firebase-config.js");return;}
    setFirebaseStatus(true,"Firebase connecté");initMap();setupEvents();
    window.auth.onAuthStateChanged(async user=>{currentUser=user||null;await loadRole();bindRealtime();renderAll();});
  }
  window.addEventListener("load",init);
})();
