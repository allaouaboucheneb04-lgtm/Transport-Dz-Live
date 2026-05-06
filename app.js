(function(){
const $=id=>document.getElementById(id);
let currentUser=null,currentRole="guest",lines=[],stops=[],vehicles=[],drivers=[],unsub=[],map=null,stopPickerMap=null,stopPickerMarker=null,pickedLat=null,pickedLng=null,clientMarker=null,driverWatchId=null,lastGpsWrite=0;let editingLineId=null,editingStopId=null,editingVehicleId=null,editingDriverId=null;
const LINE_TOLERANCE_METERS=500;
const GPS_STALE_MS=120000;

function setText(id,t){const e=$(id);if(e)e.textContent=t}
function val(id){const e=$(id);return e?e.value:""}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function now(){return firebase.firestore.FieldValue.serverTimestamp()}
function tsMillis(v){ if(!v) return 0; if(typeof v==="number") return v; if(v.toMillis) return v.toMillis(); if(typeof v==="string") return Date.parse(v)||0; return 0; }

function setFirebaseStatus(ok){$("firebaseStatus").textContent=ok?"Firebase connecté":"Firebase erreur";$("firebaseStatus").className=ok?"badge green":"badge blue"}
function setAuthUi(){const b=$("openLoginBtn");if(currentUser){b.textContent="Connecté";b.className="badge green";setText("authStatus",`Connecté: ${currentUser.email} · rôle: ${currentRole}`)}else{b.textContent="Connexion";b.className="badge light";setText("authStatus","Non connecté")}}
function authError(e){console.error(e);let m=e.message||"Erreur connexion";if(e.code==="auth/operation-not-allowed")m="Active Email/Password dans Firebase Authentication.";if(e.code==="auth/unauthorized-domain")m="Ajoute le domaine GitHub dans Authorized domains.";if(e.code==="auth/invalid-credential")m="Email ou mot de passe incorrect.";setText("authStatus",m);alert(m)}
async function loadRole(){currentRole="guest";if(!currentUser){setAuthUi();return}const email=(currentUser.email||"").toLowerCase();if(email==="allaouaboucheneb04@gmail.com"){currentRole="admin";setAuthUi();return}try{const a=await db.collection("admins").doc(currentUser.uid).get();if(a.exists&&a.data().active===true){currentRole="admin"}else{const u=await db.collection("users").doc(currentUser.uid).get();currentRole=u.exists?(u.data().role||"driver"):"driver"}}catch(e){currentRole="driver"}setAuthUi()}
function requireAdmin(){if(!currentUser){alert("Connecte-toi d’abord.");return false}if(currentRole!=="admin"){alert("Compte admin requis.");return false}return true}
async function addDoc(collection,data,statusId){try{const ref=await db.collection(collection).add(data);setText(statusId,"Sauvegardé dans Firebase ✅");return ref}catch(e){console.error(e);const m="Erreur Firebase: "+(e.code||"")+" "+(e.message||e);setText(statusId,m);alert(m);return null}}
async function updateDoc(collection,id,data,statusId){try{await db.collection(collection).doc(id).set({...data,updatedAt:now()},{merge:true});setText(statusId,"Mis à jour dans Firebase ✅");return true}catch(e){console.error(e);const m="Erreur modification Firebase: "+(e.code||"")+" "+(e.message||e);setText(statusId,m);alert(m);return false}}
function openAdminPanel(panelId){document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".adminPanel").forEach(p=>p.classList.remove("active"));const panel=$(panelId);if(panel)panel.classList.add("active");const tab=document.querySelector(`[data-panel="${panelId}"]`);if(tab)tab.classList.add("active");document.querySelector('[data-page="adminPage"]')?.click();}
function resetEdit(type){if(type==="line"){editingLineId=null;$("addLineBtn").textContent="Ajouter ligne";$("lineName").value="";}if(type==="stop"){editingStopId=null;$("addStopBtn").textContent="Ajouter arrêt";$("stopName").value="";$("stopLat").value="";$("stopLng").value="";}if(type==="vehicle"){editingVehicleId=null;$("addVehicleBtn").textContent="Ajouter véhicule";$("vehicleName").value="";}if(type==="driver"){editingDriverId=null;$("addDriverBtn").textContent="Ajouter chauffeur";$("driverNameAdmin").value="";$("driverPhoneAdmin").value="";$("driverEmailAdmin").value="";}}
function editLine(id){const l=lines.find(x=>x.id===id);if(!l)return;editingLineId=id;openAdminPanel("panelLines");$("lineCity").value=l.city||"Bejaia";$("lineName").value=l.name||"";$("lineType").value=l.type||"bus";$("lineColor").value=l.color||"#2563eb";$("addLineBtn").textContent="Mettre à jour ligne";window.scrollTo({top:0,behavior:"smooth"});}
function editStop(id){const s=stops.find(x=>x.id===id);if(!s)return;editingStopId=id;openAdminPanel("panelStops");$("stopLineSelect").value=s.lineId||"";$("stopName").value=s.name||"";$("stopLat").value=s.lat??"";$("stopLng").value=s.lng??"";$("addStopBtn").textContent="Mettre à jour arrêt";window.scrollTo({top:0,behavior:"smooth"});}
function editVehicle(id){const v=vehicles.find(x=>x.id===id);if(!v)return;editingVehicleId=id;openAdminPanel("panelVehicles");$("vehicleName").value=v.name||"";$("vehicleLineSelect").value=v.lineId||"";$("vehicleDriverSelect").value=v.driverId||"";$("addVehicleBtn").textContent="Mettre à jour véhicule";window.scrollTo({top:0,behavior:"smooth"});}
function editDriver(id){const d=drivers.find(x=>x.id===id);if(!d)return;editingDriverId=id;openAdminPanel("panelDrivers");$("driverNameAdmin").value=d.name||"";$("driverPhoneAdmin").value=d.phone||"";$("driverEmailAdmin").value=d.email||d.uid||"";$("addDriverBtn").textContent="Mettre à jour chauffeur";window.scrollTo({top:0,behavior:"smooth"});}
function lineName(id){const l=lines.find(x=>x.id===id);return l?(l.name||l.id):""}
function driverName(id){const d=drivers.find(x=>x.id===id||x.email===id||x.uid===id);return d?(d.name||d.email||d.id):""}


function stopsForLine(lineId){
  if(!lineId || lineId==="all") return [];
  return stops.filter(s => s.lineId === lineId && num(s.lat)!==null && num(s.lng)!==null);
}
function clientVisibleStops(){
  const selected = val("clientLineSelect") || "all";
  if(selected === "all") return stops.filter(s => num(s.lat)!==null && num(s.lng)!==null);
  return stopsForLine(selected);
}

function distanceMeters(lat1,lng1,lat2,lng2){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function nearestDistanceToLineStops(vehicle){
  const vLat=num(vehicle.lat), vLng=num(vehicle.lng);
  if(vLat===null||vLng===null||!vehicle.lineId) return Infinity;
  const routeStops=stops.filter(s=>s.lineId===vehicle.lineId&&num(s.lat)!==null&&num(s.lng)!==null);
  if(!routeStops.length) return 0; // if no stops yet, don't hide vehicle
  return Math.min(...routeStops.map(s=>distanceMeters(vLat,vLng,num(s.lat),num(s.lng))));
}
function computeVisibility(vehicle){
  const online=vehicle.status==="online";
  const recent=Date.now()-tsMillis(vehicle.lastGpsUpdate || vehicle.updatedAt) < GPS_STALE_MS;
  const near=nearestDistanceToLineStops(vehicle)<=LINE_TOLERANCE_METERS;
  return {online,recent,near,visible:online&&recent&&near,distance:nearestDistanceToLineStops(vehicle)};
}
function visibleVehiclesForClients(){
  return vehicles.filter(v=>{
    const c=computeVisibility(v);
    const selected=val("clientLineSelect")||"all";
    return c.visible && (selected==="all"||v.lineId===selected);
  });
}

function initMap(){if(map)return;map=L.map("map").setView([36.7525,5.0843],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map)}
function bindRealtime(){unsub.forEach(f=>f&&f());unsub=[];unsub.push(db.collection("lines").onSnapshot(s=>{lines=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error));unsub.push(db.collection("stops").onSnapshot(s=>{stops=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error));unsub.push(db.collection("vehicles").onSnapshot(s=>{vehicles=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();renderDriverWorkStatus()},console.error));unsub.push(db.collection("drivers").onSnapshot(s=>{drivers=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error))}
function renderSelects(){const city=val("clientCity")||"Bejaia";const vis=lines.filter(l=>!l.city||l.city===city);const old=val("clientLineSelect")||"all";$("clientLineSelect").innerHTML='<option value="all">Toutes les lignes</option>'+vis.map(l=>`<option value="${l.id}">${l.name}</option>`).join("");$("clientLineSelect").value=[...$("clientLineSelect").options].some(o=>o.value===old)?old:"all";const lo=lines.map(l=>`<option value="${l.id}">${l.name}</option>`).join("");$("stopLineSelect").innerHTML=lo;$("vehicleLineSelect").innerHTML=lo;const dro='<option value="">Aucun chauffeur</option>'+drivers.map(d=>`<option value="${d.id}">${d.name||d.email||d.id}</option>`).join("");$("vehicleDriverSelect").innerHTML=dro;$("driverVehicleSelect").innerHTML=vehicles.map(v=>`<option value="${v.id}">${v.name} · ${lineName(v.lineId)}</option>`).join("")}
function selectedLineStopsForList(){ const sel=val("clientLineSelect")||"all"; return sel==="all" ? stops : stops.filter(s=>s.lineId===sel); }
function renderLists(){
const sel=val("clientLineSelect")||"all";
const visibleStops = selectedLineStopsForList();

$("linesAdminList").innerHTML=lines.length?lines.map(l=>`<div class="item"><strong>${l.name}</strong><span class="muted">${l.city||""} · ${l.type||"bus"}</span><div class="actions"><button class="editBtn" data-edit-line="${l.id}" type="button">Modifier</button><button class="deleteBtn" data-del-line="${l.id}" type="button">Supprimer</button></div></div>`).join(""):'<div class="muted">Aucune ligne.</div>';

$("stopsAdminList").innerHTML=stops.length?stops.map(s=>`<div class="item"><strong>${s.name}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat}, ${s.lng}</span><div class="actions"><button class="editBtn" data-edit-stop="${s.id}" type="button">Modifier</button><button class="deleteBtn" data-del-stop="${s.id}" type="button">Supprimer</button></div></div>`).join(""):'<div class="muted">Aucun arrêt.</div>';

$("vehiclesAdminList").innerHTML=vehicles.length?vehicles.map(v=>{const c=computeVisibility(v);return `<div class="item"><strong>${v.name}</strong><span class="muted">${lineName(v.lineId)} · ${driverName(v.driverId)} · ${v.status||"offline"} · ${c.visible?"visible client":"caché client"}</span><div class="actions"><button class="editBtn" data-edit-vehicle="${v.id}" type="button">Modifier</button><button class="deleteBtn" data-del-vehicle="${v.id}" type="button">Supprimer</button></div></div>`}).join(""):'<div class="muted">Aucun véhicule.</div>';

$("driversAdminList").innerHTML=drivers.length?drivers.map(d=>`<div class="item"><strong>${d.name}</strong><span class="muted">${d.phone||""} · ${d.email||""}</span><div class="actions"><button class="editBtn" data-edit-driver="${d.id}" type="button">Modifier</button><button class="deleteBtn" data-del-driver="${d.id}" type="button">Supprimer</button></div></div>`).join(""):'<div class="muted">Aucun chauffeur.</div>';

$("stopsList").innerHTML=visibleStops.length?visibleStops.map(s=>`<div class="item"><strong>🚏 ${s.name}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat}, ${s.lng}</span></div>`).join(""):'<div class="muted">Aucun arrêt.</div>';

const clientVehicles=visibleVehiclesForClients();
$("vehiclesList").innerHTML=clientVehicles.length?clientVehicles.map(v=>`<div class="item"><strong>🚌 ${v.name}</strong><span class="muted">${lineName(v.lineId)} · En ligne · GPS récent</span></div>`).join(""):'<div class="muted">Aucun bus en ligne sur sa ligne.</div>';

document.querySelectorAll("[data-edit-line]").forEach(b=>b.onclick=()=>editLine(b.dataset.editLine));
document.querySelectorAll("[data-edit-stop]").forEach(b=>b.onclick=()=>editStop(b.dataset.editStop));
document.querySelectorAll("[data-edit-vehicle]").forEach(b=>b.onclick=()=>editVehicle(b.dataset.editVehicle));
document.querySelectorAll("[data-edit-driver]").forEach(b=>b.onclick=()=>editDriver(b.dataset.editDriver));

document.querySelectorAll("[data-del-line]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("lines").doc(b.dataset.delLine).delete());
document.querySelectorAll("[data-del-stop]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("stops").doc(b.dataset.delStop).delete());
document.querySelectorAll("[data-del-vehicle]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("vehicles").doc(b.dataset.delVehicle).delete());
document.querySelectorAll("[data-del-driver]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("drivers").doc(b.dataset.delDriver).delete())
}
function drawMap(){
if(!map)return;
map.eachLayer(layer=>{
  if(layer instanceof L.Marker||layer instanceof L.CircleMarker||layer instanceof L.Polyline) map.removeLayer(layer)
});

const selected = val("clientLineSelect") || "all";
const visible = clientVisibleStops();

// Draw stops
visible.forEach(s=>{
  const color=lines.find(l=>l.id===s.lineId)?.color||"#2563eb";
  L.circleMarker([num(s.lat),num(s.lng)],{
    radius:8,color,fillColor:color,weight:3,fillOpacity:.9
  }).addTo(map).bindPopup(`🚏 ${s.name}<br>${lineName(s.lineId)}`);
});

// Draw routes ONLY by their own lineId
if(selected !== "all"){
  const routeStops = stopsForLine(selected);
  const color = lines.find(l=>l.id===selected)?.color || "#2563eb";
  if(routeStops.length > 1){
    L.polyline(routeStops.map(s=>[num(s.lat),num(s.lng)]),{
      color,weight:5,opacity:.65
    }).addTo(map);
  }
}else{
  // When all lines selected, draw one polyline per line only, never connect different lines together
  lines.forEach(line=>{
    const routeStops = stopsForLine(line.id);
    if(routeStops.length > 1){
      L.polyline(routeStops.map(s=>[num(s.lat),num(s.lng)]),{
        color:line.color||"#2563eb",weight:4,opacity:.50
      }).addTo(map);
    }
  });
}

// Draw visible vehicles only
visibleVehiclesForClients().forEach(v=>{
  if(num(v.lat)===null||num(v.lng)===null) return;
  L.marker([num(v.lat),num(v.lng)])
    .addTo(map)
    .bindPopup(`🚌 ${v.name}<br>${lineName(v.lineId)}<br>En ligne`);
});

if(clientMarker) clientMarker.addTo(map);
}
function renderAll(){renderSelects();renderLists();drawMap()}

async function saveLine(){if(!requireAdmin())return;const btn=$("addLineBtn");btn.disabled=true;btn.textContent=editingLineId?"Mise à jour...":"Enregistrement...";const name=val("lineName").trim();if(!name){btn.disabled=false;btn.textContent=editingLineId?"Mettre à jour ligne":"Ajouter ligne";return alert("Nom ligne obligatoire.")}const data={city:val("lineCity")||"Bejaia",name,type:val("lineType")||"bus",color:val("lineColor")||"#2563eb",active:true};let ok=false;if(editingLineId){ok=await updateDoc("lines",editingLineId,data,"lineStatus")}else{ok=await addDoc("lines",{...data,createdAt:now(),updatedAt:now()},"lineStatus")}if(ok){resetEdit("line")}btn.disabled=false;btn.textContent=editingLineId?"Mettre à jour ligne":"Ajouter ligne"}
async function saveStop(){if(!requireAdmin())return;const btn=$("addStopBtn");btn.disabled=true;btn.textContent=editingStopId?"Mise à jour...":"Enregistrement...";const name=val("stopName").trim(),lat=num(val("stopLat")),lng=num(val("stopLng"));if(!name){btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt";return alert("Nom arrêt obligatoire.")}if(!val("stopLineSelect")){btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt";return alert("Choisis une ligne pour cet arrêt.")}if(lat===null||lng===null){btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt";return alert("Latitude/longitude invalide.")}const data={lineId:val("stopLineSelect"),name,lat,lng,active:true};let ok=false;if(editingStopId){ok=await updateDoc("stops",editingStopId,data,"stopStatus")}else{ok=await addDoc("stops",{...data,createdAt:now(),updatedAt:now()},"stopStatus")}if(ok){resetEdit("stop")}btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt"}
async function saveVehicle(){if(!requireAdmin())return;const btn=$("addVehicleBtn");btn.disabled=true;btn.textContent=editingVehicleId?"Mise à jour...":"Enregistrement...";const name=val("vehicleName").trim();if(!name){btn.disabled=false;btn.textContent=editingVehicleId?"Mettre à jour véhicule":"Ajouter véhicule";return alert("Nom véhicule obligatoire.")}const data={name,lineId:val("vehicleLineSelect"),driverId:val("vehicleDriverSelect"),active:true};let ok=false;if(editingVehicleId){ok=await updateDoc("vehicles",editingVehicleId,data,"vehicleStatus")}else{ok=await addDoc("vehicles",{...data,status:"offline",visibleToClients:false,lat:null,lng:null,createdAt:now(),updatedAt:now()},"vehicleStatus")}if(ok){resetEdit("vehicle")}btn.disabled=false;btn.textContent=editingVehicleId?"Mettre à jour véhicule":"Ajouter véhicule"}
async function saveDriver(){if(!requireAdmin())return;const btn=$("addDriverBtn");btn.disabled=true;btn.textContent=editingDriverId?"Mise à jour...":"Enregistrement...";const name=val("driverNameAdmin").trim();if(!name){btn.disabled=false;btn.textContent=editingDriverId?"Mettre à jour chauffeur":"Ajouter chauffeur";return alert("Nom chauffeur obligatoire.")}const data={name,phone:val("driverPhoneAdmin").trim(),email:val("driverEmailAdmin").trim(),uid:val("driverEmailAdmin").trim(),active:true};let ok=false;if(editingDriverId){ok=await updateDoc("drivers",editingDriverId,data,"driverAdminStatus")}else{ok=await addDoc("drivers",{...data,createdAt:now(),updatedAt:now()},"driverAdminStatus")}if(ok){resetEdit("driver")}btn.disabled=false;btn.textContent=editingDriverId?"Mettre à jour chauffeur":"Ajouter chauffeur"}
function currentDriverVehicle(){return vehicles.find(v=>v.id===val("driverVehicleSelect"))}
function renderDriverWorkStatus(){const v=currentDriverVehicle();const badge=$("driverWorkBadge");if(!badge)return;if(!v||v.status!=="online"){badge.textContent="Hors ligne";badge.className="workBadge offline";return}const c=computeVisibility(v);badge.textContent=c.visible?"En ligne · Visible client":"En ligne · Hors ligne client";badge.className=c.visible?"workBadge online":"workBadge warning"}
async function goOnline(){if(!currentUser)return alert("Connecte-toi.");const vehicleId=val("driverVehicleSelect");if(!vehicleId)return alert("Choisis un véhicule.");const v=currentDriverVehicle();if(!v)return alert("Véhicule introuvable.");setText("driverStatus","Demande GPS...");if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);await db.collection("vehicles").doc(vehicleId).set({status:"online",driverId:currentUser.uid,driverName:val("driverNameInput")||currentUser.email,onlineAt:now(),updatedAt:now()}, {merge:true});driverWatchId=navigator.geolocation.watchPosition(async p=>{const t=Date.now();const interval=Number(val("driverGpsFrequency")||30000);if(t-lastGpsWrite<interval)return;lastGpsWrite=t;const temp={...v,lat:p.coords.latitude,lng:p.coords.longitude,status:"online",lastGpsUpdate:t};const c=computeVisibility(temp);try{await db.collection("vehicles").doc(vehicleId).set({lat:p.coords.latitude,lng:p.coords.longitude,status:"online",driverId:currentUser.uid,driverName:val("driverNameInput")||currentUser.email,lastGpsUpdate:firebase.firestore.Timestamp.fromDate(new Date()),updatedAt:now(),visibleToClients:c.visible,offRoute:!c.near,distanceFromLineMeters:Math.round(c.distance||0)}, {merge:true});setText("driverStatus",c.visible?"En ligne ✅ visible aux clients":"En ligne mais caché client: hors ligne de bus ou GPS ancien");renderDriverWorkStatus()}catch(e){alert("Erreur GPS Firebase: "+e.message)}},e=>{setText("driverStatus","GPS impossible ou refusé.");alert("GPS impossible ou refusé.")},{enableHighAccuracy:false,timeout:20000,maximumAge:10000});setText("driverStatus","En ligne. GPS démarré.")}
async function goOffline(){const vehicleId=val("driverVehicleSelect");if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);driverWatchId=null;if(vehicleId){await db.collection("vehicles").doc(vehicleId).set({status:"offline",visibleToClients:false,offRoute:false,offlineAt:now(),updatedAt:now()}, {merge:true})}setText("driverStatus","Hors ligne. Le bus est caché aux clients.");renderDriverWorkStatus()}

function clientGps(){if(!navigator.geolocation)return alert("GPS non disponible.");navigator.geolocation.getCurrentPosition(p=>{const lat=p.coords.latitude,lng=p.coords.longitude;map.setView([lat,lng],16);if(clientMarker)clientMarker.setLatLng([lat,lng]);else clientMarker=L.circleMarker([lat,lng],{radius:10,weight:3,fillOpacity:.85}).addTo(map);clientMarker.bindPopup("Ma position").openPopup()},()=>alert("GPS impossible ou refusé."),{enableHighAccuracy:false,timeout:20000,maximumAge:60000})}
function getPosition(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res([p.coords.latitude,p.coords.longitude]),rej,{enableHighAccuracy:false,timeout:20000,maximumAge:60000}):rej(new Error("GPS non disponible")))}
function initStopPicker(){if(stopPickerMap)return;stopPickerMap=L.map("stopPickerMap").setView([36.7525,5.0843],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(stopPickerMap);stopPickerMap.on("click",e=>setPicked(e.latlng.lat,e.latlng.lng))}
function setPicked(lat,lng){pickedLat=lat;pickedLng=lng;if(stopPickerMarker)stopPickerMarker.setLatLng([lat,lng]);else{stopPickerMarker=L.marker([lat,lng],{draggable:true}).addTo(stopPickerMap);stopPickerMarker.on("dragend",()=>{const p=stopPickerMarker.getLatLng();setPicked(p.lat,p.lng)})}setText("pickedCoords",`Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`)}
function openStopPicker(){$("stopPickerModal").classList.remove("hidden");setTimeout(()=>{initStopPicker();const lat=num(val("stopLat"))||36.7525,lng=num(val("stopLng"))||5.0843;stopPickerMap.invalidateSize();stopPickerMap.setView([lat,lng],14);setPicked(lat,lng)},180)}

function setupEvents(){$("openLoginBtn").onclick=()=>$("loginModal").classList.remove("hidden");$("closeLoginBtn").onclick=()=>$("loginModal").classList.add("hidden");$("loginBtn").onclick=async()=>{try{setText("authStatus","Connexion...");const cred=await auth.signInWithEmailAndPassword(val("emailInput").trim(),val("passwordInput"));currentUser=cred.user;await loadRole();$("loginModal").classList.add("hidden")}catch(e){authError(e)}};$("signupBtn").onclick=async()=>{try{const cred=await auth.createUserWithEmailAndPassword(val("emailInput").trim(),val("passwordInput"));currentUser=cred.user;await loadRole()}catch(e){authError(e)}};$("logoutBtn").onclick=async()=>{await goOffline().catch(()=>{});await auth.signOut();currentUser=null;currentRole="guest";setAuthUi()};document.querySelectorAll(".navBtn").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".navBtn").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.page).classList.add("active");setTimeout(()=>map&&map.invalidateSize(),250)});document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".adminPanel").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.panel).classList.add("active")});$("addLineBtn").onclick=saveLine;$("addStopBtn").onclick=saveStop;$("addVehicleBtn").onclick=saveVehicle;$("addDriverBtn").onclick=saveDriver;$("goOnlineBtn").onclick=goOnline;$("goOfflineBtn").onclick=goOffline;$("driverVehicleSelect").onchange=renderDriverWorkStatus;$("clientGpsBtn").onclick=clientGps;$("clientLineSelect").onchange=renderAll;$("clientCity").onchange=renderAll;$("searchRouteBtn").onclick=()=>{const q=(val("fromInput")+" "+val("toInput")).toLowerCase();const found=stops.filter(s=>(s.name||"").toLowerCase().includes(q));setText("routeResult",found.length?found.length+" arrêt(s) trouvé(s).":"Aucun trajet automatique pour le moment.")};$("useMyLocationStopBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();$("stopLat").value=lat.toFixed(6);$("stopLng").value=lng.toFixed(6)}catch(e){alert("GPS impossible.")}};$("pickStopOnMapBtn").onclick=openStopPicker;$("pickerCloseBtn").onclick=()=>$("stopPickerModal").classList.add("hidden");$("pickerUseGpsBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();initStopPicker();stopPickerMap.setView([lat,lng],16);setPicked(lat,lng)}catch(e){alert("GPS impossible.")}};$("pickerConfirmBtn").onclick=()=>{if(pickedLat==null)return alert("Choisis une position.");$("stopLat").value=pickedLat.toFixed(6);$("stopLng").value=pickedLng.toFixed(6);$("stopPickerModal").classList.add("hidden")}}
function init(){setFirebaseStatus(true);initMap();setupEvents();auth.onAuthStateChanged(async user=>{currentUser=user;await loadRole();bindRealtime()});setInterval(renderAll,30000)}
window.addEventListener("load",init);
})();
