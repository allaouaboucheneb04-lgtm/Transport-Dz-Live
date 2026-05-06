(function(){
const $=id=>document.getElementById(id);
let currentUser=null,currentRole="guest",lines=[],stops=[],vehicles=[],drivers=[],unsub=[],map=null,stopPickerMap=null,stopPickerMarker=null,pickedLat=null,pickedLng=null,clientMarker=null,driverWatchId=null,lastGpsWrite=0;
function setText(id,t){const e=$(id);if(e)e.textContent=t}
function val(id){const e=$(id);return e?e.value:""}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function now(){return firebase.firestore.FieldValue.serverTimestamp()}
function setFirebaseStatus(ok){$("firebaseStatus").textContent=ok?"Firebase connecté":"Firebase erreur";$("firebaseStatus").className=ok?"badge green":"badge blue"}
function setAuthUi(){const b=$("openLoginBtn");if(currentUser){b.textContent="Connecté";b.className="badge green";setText("authStatus",`Connecté: ${currentUser.email} · rôle: ${currentRole}`)}else{b.textContent="Connexion";b.className="badge light";setText("authStatus","Non connecté")}}
function authError(e){console.error(e);let m=e.message||"Erreur connexion";if(e.code==="auth/operation-not-allowed")m="Active Email/Password dans Firebase Authentication.";if(e.code==="auth/unauthorized-domain")m="Ajoute le domaine GitHub dans Authorized domains.";if(e.code==="auth/invalid-credential")m="Email ou mot de passe incorrect.";setText("authStatus",m);alert(m)}
async function loadRole(){currentRole="guest";if(!currentUser){setAuthUi();return}const email=(currentUser.email||"").toLowerCase();if(email==="allaouaboucheneb04@gmail.com"){currentRole="admin";setAuthUi();return}try{const a=await db.collection("admins").doc(currentUser.uid).get();if(a.exists&&a.data().active===true){currentRole="admin"}else{const u=await db.collection("users").doc(currentUser.uid).get();currentRole=u.exists?(u.data().role||"driver"):"driver"}}catch(e){currentRole="driver"}setAuthUi()}
function requireAdmin(){if(!currentUser){alert("Connecte-toi d’abord.");return false}if(currentRole!=="admin"){alert("Compte admin requis.");return false}return true}
async function addDoc(collection,data,statusId){try{const ref=await db.collection(collection).add(data);setText(statusId,"Sauvegardé dans Firebase ✅");return ref}catch(e){console.error(e);const m="Erreur Firebase: "+(e.code||"")+" "+(e.message||e);setText(statusId,m);alert(m);return null}}
function lineName(id){const l=lines.find(x=>x.id===id);return l?(l.name||l.id):""}
function driverName(id){const d=drivers.find(x=>x.id===id||x.email===id||x.uid===id);return d?(d.name||d.email||d.id):""}
function initMap(){if(map)return;map=L.map("map").setView([36.7525,5.0843],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map)}
function bindRealtime(){unsub.forEach(f=>f&&f());unsub=[];unsub.push(db.collection("lines").onSnapshot(s=>{lines=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error));unsub.push(db.collection("stops").onSnapshot(s=>{stops=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error));unsub.push(db.collection("vehicles").onSnapshot(s=>{vehicles=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error));unsub.push(db.collection("drivers").onSnapshot(s=>{drivers=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error))}
function renderSelects(){const city=val("clientCity")||"Bejaia";const vis=lines.filter(l=>!l.city||l.city===city);const old=val("clientLineSelect")||"all";$("clientLineSelect").innerHTML='<option value="all">Toutes les lignes</option>'+vis.map(l=>`<option value="${l.id}">${l.name}</option>`).join("");$("clientLineSelect").value=[...$("clientLineSelect").options].some(o=>o.value===old)?old:"all";const lo=lines.map(l=>`<option value="${l.id}">${l.name}</option>`).join("");$("stopLineSelect").innerHTML=lo;$("vehicleLineSelect").innerHTML=lo;const dro='<option value="">Aucun chauffeur</option>'+drivers.map(d=>`<option value="${d.id}">${d.name||d.email||d.id}</option>`).join("");$("vehicleDriverSelect").innerHTML=dro;$("driverVehicleSelect").innerHTML=vehicles.map(v=>`<option value="${v.id}">${v.name}</option>`).join("")}
function renderLists(){const sel=val("clientLineSelect")||"all";const visibleStops=stops.filter(s=>sel==="all"||s.lineId===sel);$("linesAdminList").innerHTML=lines.length?lines.map(l=>`<div class="item"><strong>${l.name}</strong><span class="muted">${l.city||""} · ${l.type||"bus"}</span><button class="deleteBtn" data-del-line="${l.id}" type="button">Supprimer</button></div>`).join(""):'<div class="muted">Aucune ligne.</div>';$("stopsAdminList").innerHTML=stops.length?stops.map(s=>`<div class="item"><strong>${s.name}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat}, ${s.lng}</span><button class="deleteBtn" data-del-stop="${s.id}" type="button">Supprimer</button></div>`).join(""):'<div class="muted">Aucun arrêt.</div>';$("vehiclesAdminList").innerHTML=vehicles.length?vehicles.map(v=>`<div class="item"><strong>${v.name}</strong><span class="muted">${lineName(v.lineId)} · ${driverName(v.driverId)} · ${v.status||"inactive"}</span><button class="deleteBtn" data-del-vehicle="${v.id}" type="button">Supprimer</button></div>`).join(""):'<div class="muted">Aucun véhicule.</div>';$("driversAdminList").innerHTML=drivers.length?drivers.map(d=>`<div class="item"><strong>${d.name}</strong><span class="muted">${d.phone||""} · ${d.email||""}</span><button class="deleteBtn" data-del-driver="${d.id}" type="button">Supprimer</button></div>`).join(""):'<div class="muted">Aucun chauffeur.</div>';$("stopsList").innerHTML=visibleStops.length?visibleStops.map(s=>`<div class="item"><strong>🚏 ${s.name}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat}, ${s.lng}</span></div>`).join(""):'<div class="muted">Aucun arrêt.</div>';$("vehiclesList").innerHTML=vehicles.length?vehicles.map(v=>`<div class="item"><strong>🚌 ${v.name}</strong><span class="muted">${lineName(v.lineId)} · ${v.status||"inactive"}</span></div>`).join(""):'<div class="muted">Aucun véhicule.</div>';document.querySelectorAll("[data-del-line]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("lines").doc(b.dataset.delLine).delete());document.querySelectorAll("[data-del-stop]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("stops").doc(b.dataset.delStop).delete());document.querySelectorAll("[data-del-vehicle]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("vehicles").doc(b.dataset.delVehicle).delete());document.querySelectorAll("[data-del-driver]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("drivers").doc(b.dataset.delDriver).delete())}
function drawMap(){if(!map)return;map.eachLayer(layer=>{if(layer instanceof L.Marker||layer instanceof L.CircleMarker||layer instanceof L.Polyline)map.removeLayer(layer)});const sel=val("clientLineSelect")||"all";const visible=stops.filter(s=>num(s.lat)!==null&&num(s.lng)!==null&&(sel==="all"||s.lineId===sel));const groups={};visible.forEach(s=>{const color=lines.find(l=>l.id===s.lineId)?.color||"#2563eb";L.circleMarker([num(s.lat),num(s.lng)],{radius:8,color,fillColor:color,weight:3,fillOpacity:.9}).addTo(map).bindPopup(`🚏 ${s.name}<br>${lineName(s.lineId)}`);if(s.lineId){groups[s.lineId]=groups[s.lineId]||[];groups[s.lineId].push([num(s.lat),num(s.lng)])}});Object.keys(groups).forEach(id=>{if(groups[id].length>1){const color=lines.find(l=>l.id===id)?.color||"#2563eb";L.polyline(groups[id],{color,weight:4,opacity:.55}).addTo(map)}});vehicles.forEach(v=>{if(num(v.lat)===null||num(v.lng)===null)return;L.marker([num(v.lat),num(v.lng)]).addTo(map).bindPopup(`🚌 ${v.name}<br>${lineName(v.lineId)}<br>${v.status||""}`)});if(clientMarker)clientMarker.addTo(map)}
function renderAll(){renderSelects();renderLists();drawMap()}
async function saveLine(){if(!requireAdmin())return;const btn=$("addLineBtn");btn.disabled=true;btn.textContent="Enregistrement...";const name=val("lineName").trim();if(!name){btn.disabled=false;btn.textContent="Ajouter ligne";return alert("Nom ligne obligatoire.")}const ref=await addDoc("lines",{city:val("lineCity")||"Bejaia",name,type:val("lineType")||"bus",color:val("lineColor")||"#2563eb",active:true,createdAt:now(),updatedAt:now()},"lineStatus");if(ref)$("lineName").value="";btn.disabled=false;btn.textContent="Ajouter ligne"}
async function saveStop(){if(!requireAdmin())return;const name=val("stopName").trim(),lat=num(val("stopLat")),lng=num(val("stopLng"));if(!name)return alert("Nom arrêt obligatoire.");if(lat===null||lng===null)return alert("Latitude/longitude invalide.");const ref=await addDoc("stops",{lineId:val("stopLineSelect"),name,lat,lng,active:true,createdAt:now(),updatedAt:now()},"stopStatus");if(ref){$("stopName").value="";$("stopLat").value="";$("stopLng").value=""}}
async function saveVehicle(){if(!requireAdmin())return;const name=val("vehicleName").trim();if(!name)return alert("Nom véhicule obligatoire.");const ref=await addDoc("vehicles",{name,lineId:val("vehicleLineSelect"),driverId:val("vehicleDriverSelect"),status:"inactive",lat:null,lng:null,active:true,createdAt:now(),updatedAt:now()},"vehicleStatus");if(ref)$("vehicleName").value=""}
async function saveDriver(){if(!requireAdmin())return;const name=val("driverNameAdmin").trim();if(!name)return alert("Nom chauffeur obligatoire.");const ref=await addDoc("drivers",{name,phone:val("driverPhoneAdmin").trim(),email:val("driverEmailAdmin").trim(),uid:val("driverEmailAdmin").trim(),active:true,createdAt:now(),updatedAt:now()},"driverAdminStatus");if(ref){$("driverNameAdmin").value="";$("driverPhoneAdmin").value="";$("driverEmailAdmin").value=""}}
function clientGps(){if(!navigator.geolocation)return alert("GPS non disponible.");navigator.geolocation.getCurrentPosition(p=>{const lat=p.coords.latitude,lng=p.coords.longitude;map.setView([lat,lng],16);if(clientMarker)clientMarker.setLatLng([lat,lng]);else clientMarker=L.circleMarker([lat,lng],{radius:10,weight:3,fillOpacity:.85}).addTo(map);clientMarker.bindPopup("Ma position").openPopup()},()=>alert("GPS impossible ou refusé."),{enableHighAccuracy:false,timeout:20000,maximumAge:60000})}
function getPosition(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res([p.coords.latitude,p.coords.longitude]),rej,{enableHighAccuracy:false,timeout:20000,maximumAge:60000}):rej(new Error("GPS non disponible")))}
function initStopPicker(){if(stopPickerMap)return;stopPickerMap=L.map("stopPickerMap").setView([36.7525,5.0843],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(stopPickerMap);stopPickerMap.on("click",e=>setPicked(e.latlng.lat,e.latlng.lng))}
function setPicked(lat,lng){pickedLat=lat;pickedLng=lng;if(stopPickerMarker)stopPickerMarker.setLatLng([lat,lng]);else{stopPickerMarker=L.marker([lat,lng],{draggable:true}).addTo(stopPickerMap);stopPickerMarker.on("dragend",()=>{const p=stopPickerMarker.getLatLng();setPicked(p.lat,p.lng)})}setText("pickedCoords",`Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`)}
function openStopPicker(){$("stopPickerModal").classList.remove("hidden");setTimeout(()=>{initStopPicker();const lat=num(val("stopLat"))||36.7525,lng=num(val("stopLng"))||5.0843;stopPickerMap.invalidateSize();stopPickerMap.setView([lat,lng],14);setPicked(lat,lng)},180)}
function startDriverGps(){if(!currentUser)return alert("Connecte-toi.");const vehicleId=val("driverVehicleSelect");if(!vehicleId)return alert("Choisis un véhicule.");const interval=Number(val("driverGpsFrequency")||30000);if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);driverWatchId=navigator.geolocation.watchPosition(async p=>{const t=Date.now();if(t-lastGpsWrite<interval)return;lastGpsWrite=t;try{await db.collection("vehicles").doc(vehicleId).set({lat:p.coords.latitude,lng:p.coords.longitude,driverId:currentUser.uid,driverName:val("driverNameInput")||currentUser.email,status:"active",updatedAt:now()},{merge:true});setText("driverStatus","GPS envoyé: "+new Date().toLocaleTimeString())}catch(e){alert("Erreur GPS Firebase: "+e.message)}},()=>alert("GPS chauffeur impossible."),{enableHighAccuracy:false,timeout:20000,maximumAge:10000});setText("driverStatus","GPS démarré.")}
function stopDriverGps(){if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);driverWatchId=null;setText("driverStatus","GPS arrêté.")}
function setupEvents(){$("openLoginBtn").onclick=()=>$("loginModal").classList.remove("hidden");$("closeLoginBtn").onclick=()=>$("loginModal").classList.add("hidden");$("loginBtn").onclick=async()=>{try{setText("authStatus","Connexion...");const cred=await auth.signInWithEmailAndPassword(val("emailInput").trim(),val("passwordInput"));currentUser=cred.user;await loadRole();$("loginModal").classList.add("hidden")}catch(e){authError(e)}};$("signupBtn").onclick=async()=>{try{const cred=await auth.createUserWithEmailAndPassword(val("emailInput").trim(),val("passwordInput"));currentUser=cred.user;await loadRole()}catch(e){authError(e)}};$("logoutBtn").onclick=async()=>{await auth.signOut();currentUser=null;currentRole="guest";setAuthUi()};document.querySelectorAll(".navBtn").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".navBtn").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.page).classList.add("active");setTimeout(()=>map&&map.invalidateSize(),250)});document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".adminPanel").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.panel).classList.add("active")});$("addLineBtn").onclick=saveLine;$("addStopBtn").onclick=saveStop;$("addVehicleBtn").onclick=saveVehicle;$("addDriverBtn").onclick=saveDriver;$("clientGpsBtn").onclick=clientGps;$("clientLineSelect").onchange=renderAll;$("clientCity").onchange=renderAll;$("searchRouteBtn").onclick=()=>{const q=(val("fromInput")+" "+val("toInput")).toLowerCase();const found=stops.filter(s=>(s.name||"").toLowerCase().includes(q));setText("routeResult",found.length?found.length+" arrêt(s) trouvé(s).":"Aucun trajet automatique pour le moment.")};$("useMyLocationStopBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();$("stopLat").value=lat.toFixed(6);$("stopLng").value=lng.toFixed(6)}catch(e){alert("GPS impossible.")}};$("pickStopOnMapBtn").onclick=openStopPicker;$("pickerCloseBtn").onclick=()=>$("stopPickerModal").classList.add("hidden");$("pickerUseGpsBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();initStopPicker();stopPickerMap.setView([lat,lng],16);setPicked(lat,lng)}catch(e){alert("GPS impossible.")}};$("pickerConfirmBtn").onclick=()=>{if(pickedLat==null)return alert("Choisis une position.");$("stopLat").value=pickedLat.toFixed(6);$("stopLng").value=pickedLng.toFixed(6);$("stopPickerModal").classList.add("hidden")};$("startDriverGpsBtn").onclick=startDriverGps;$("stopDriverGpsBtn").onclick=stopDriverGps}
function init(){setFirebaseStatus(true);initMap();setupEvents();auth.onAuthStateChanged(async user=>{currentUser=user;await loadRole();bindRealtime()})}
window.addEventListener("load",init);
})();


/* Firestore visible debug */
(function(){
  function ready(fn){ document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn(); }
  function out(msg){
    const el = document.getElementById("firestoreDebugText") || document.getElementById("debug");
    if(el) el.textContent = msg;
    console.log("[Firestore Debug]", msg);
  }
  ready(function(){
    setTimeout(function(){
      if(!window.firebase){ out("❌ Firebase SDK non chargé"); return; }
      if(!window.db){ out("❌ window.db non chargé. firebase-config.js ne marche pas."); return; }

      out("Connexion Firestore...\nProjet: transport-dz-live-5d1fb\nLecture lines/stops...");
      let lineCount = 0;
      let stopCount = 0;
      let lineSamples = [];
      let stopSamples = [];
      let errors = [];

      window.db.collection("lines").onSnapshot(function(snap){
        lineCount = snap.size;
        lineSamples = snap.docs.slice(0,3).map(function(d){ return d.id + " => " + JSON.stringify(d.data()); });
        render();
      }, function(err){
        errors.push("lines: " + err.code + " " + err.message);
        render();
      });

      window.db.collection("stops").onSnapshot(function(snap){
        stopCount = snap.size;
        stopSamples = snap.docs.slice(0,3).map(function(d){ return d.id + " => " + JSON.stringify(d.data()); });
        render();
      }, function(err){
        errors.push("stops: " + err.code + " " + err.message);
        render();
      });

      function render(){
        out(
          "✅ Firestore chargé\n" +
          "Projet: transport-dz-live-5d1fb\n\n" +
          "lines trouvées: " + lineCount + "\n" +
          (lineSamples.length ? lineSamples.join("\n") : "Aucune ligne lue") + "\n\n" +
          "stops trouvés: " + stopCount + "\n" +
          (stopSamples.length ? stopSamples.join("\n") : "Aucun arrêt lu") + "\n\n" +
          (errors.length ? "ERREURS:\n" + errors.join("\n") : "Aucune erreur de lecture.")
        );
      }
    }, 1200);
  });
})();


/* SERVER FIRESTORE DEBUG */
(function(){
  function ready(fn){ document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn(); }
  function out(msg){
    var el = document.getElementById("firestoreDebugText");
    if(el) el.textContent = msg;
    console.log("[SERVER DEBUG]", msg);
  }
  function safe(v){ try { return JSON.stringify(v, null, 2); } catch(e){ return String(v); } }

  ready(function(){
    setTimeout(async function(){
      try{
        if(!window.firebase){ out("❌ Firebase SDK non chargé"); return; }
        if(!firebase.apps.length){ out("❌ Firebase app non initialisée"); return; }
        if(!window.db){ out("❌ window.db non chargé"); return; }

        const appProject = firebase.app().options.projectId;
        const authUser = window.auth && window.auth.currentUser ? window.auth.currentUser : null;

        let msg = "✅ SDK chargé\n";
        msg += "projectId réel du site: " + appProject + "\n";
        msg += "auth email: " + (authUser ? authUser.email : "NON CONNECTÉ") + "\n";
        msg += "auth uid: " + (authUser ? authUser.uid : "NON CONNECTÉ") + "\n\n";

        msg += "Lecture serveur Firestore...\n";
        out(msg);

        const lineSnap = await window.db.collection("lines").get({source:"server"});
        const stopSnap = await window.db.collection("stops").get({source:"server"});

        msg += "\nlines serveur trouvées: " + lineSnap.size + "\n";
        if(lineSnap.size){
          lineSnap.docs.slice(0,5).forEach(function(d){
            msg += "- " + d.id + " => " + safe(d.data()) + "\n";
          });
        } else {
          msg += "Aucune ligne sur le serveur.\n";
        }

        msg += "\nstops serveur trouvés: " + stopSnap.size + "\n";
        if(stopSnap.size){
          stopSnap.docs.slice(0,5).forEach(function(d){
            msg += "- " + d.id + " => " + safe(d.data()) + "\n";
          });
        } else {
          msg += "Aucun arrêt sur le serveur.\n";
        }

        out(msg);
      }catch(e){
        out("❌ ERREUR LECTURE SERVEUR\n" + (e.code || "") + "\n" + (e.message || e));
        console.error(e);
      }
    }, 1800);
  });
})();
