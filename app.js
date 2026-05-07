(function(){
const $=id=>document.getElementById(id);
let currentUser=null,currentRole="guest",lines=[],stops=[],vehicles=[],drivers=[],driverRequests=[],walkingTracks=[],unsub=[],map=null,stopPickerMap=null,stopPickerMarker=null,pickedLat=null,pickedLng=null,clientMarker=null,driverWatchId=null,lastGpsWrite=0;let editingLineId=null,editingStopId=null,editingVehicleId=null,editingDriverId=null;let routeCache={};let osmStopsLayer=null,osmStopsGeojson=null;let bejaiaGeojson=null,bejaiaGeojsonLayer=null;let walkingTrackWatchId=null,walkingTrackPoints=[],walkingTrackStart=0;let routeLayers=[];let routeSearchLayers=[];let routeFocusActive=false;
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
async function loadRole(){
  userRole=null;
  if(!currentUser){renderAuth();return;}
  try{
    if(currentUser.email==="allaouaboucheneb04@gmail.com") userRole="admin";
    else{
      const doc=await db.collection("users").doc(currentUser.uid).get();
      userRole=doc.exists ? (doc.data().role||"client") : "client";
    }
  }catch(e){console.warn(e);userRole="client";}
  renderAuth();
  applyRoleVisibility();
}
function clientVisibleStops(){
  const selected = val("clientLineSelect") || "all";
  if(selected === "all") return activeStopsOnly().filter(s => num(s.lat)!==null && num(s.lng)!==null);
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
  return vehicles.filter(v => enhancedVehicleVisible(v).visible);
}


async function loadOsmStopsGeojson(){
  try{
    const res = await fetch("./data/algeria-osm-stops.geojson?v=1");
    if(!res.ok) throw new Error("Fichier GeoJSON introuvable");
    osmStopsGeojson = await res.json();
    renderOsmStopsOnMap();
    setText("osmImportStatus","GeoJSON OSM chargé ✅");
  }catch(e){
    console.warn(e);
    setText("osmImportStatus","GeoJSON OSM non chargé: "+(e.message||e));
  }
}
function renderOsmStopsOnMap(){
  if(!map || !osmStopsGeojson) return;
  if(osmStopsLayer){ try{map.removeLayer(osmStopsLayer)}catch(e){} osmStopsLayer=null; }
  const toggle=$("showOsmStopsToggle");
  if(toggle && !toggle.checked) return;
  osmStopsLayer=L.geoJSON(osmStopsGeojson,{
    pointToLayer:function(feature,latlng){
      return L.circleMarker(latlng,{radius:6,color:"#fff",weight:2,fillColor:"#f59e0b",fillOpacity:.95});
    },
    onEachFeature:function(feature,layer){
      const p=feature.properties||{};
      const name=p.name||p.local_ref||p.ref||"Arrêt OSM";
      layer.bindPopup("🚌 "+name+"<br><small>OpenStreetMap</small>");
    }
  }).addTo(map);
}
function osmStopsArray(){
  if(!osmStopsGeojson || !Array.isArray(osmStopsGeojson.features)) return [];
  return osmStopsGeojson.features.filter(f=>f.geometry&&f.geometry.type==="Point").map((f,i)=>{
    const p=f.properties||{}, c=f.geometry.coordinates||[];
    return {name:p.name||p.local_ref||p.ref||("Arrêt OSM "+(i+1)), lat:Number(c[1]), lng:Number(c[0]), osmId:p["@id"]||f.id||""};
  }).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng));
}
function renderOsmLineSelect(){
  const sel=$("osmImportLineSelect");
  if(!sel) return;
  const old=sel.value;
  sel.innerHTML='<option value="">Choisir une ligne...</option>'+lines.map(l=>`<option value="${l.id}">${l.name||l.id}</option>`).join("");
  if([...sel.options].some(o=>o.value===old)) sel.value=old;
}
async function importOsmStopsToFirebase(){
  if(!requireAdmin()) return;
  if(!osmStopsGeojson) await loadOsmStopsGeojson();
  const lineId=val("osmImportLineSelect");
  if(!lineId) return alert("Choisis une ligne Firebase.");
  const line=lines.find(l=>l.id===lineId);
  const arr=osmStopsArray();
  if(!arr.length) return alert("Aucun arrêt dans le GeoJSON.");
  const btn=$("importOsmStopsBtn");
  if(btn){btn.disabled=true;btn.textContent="Import...";}
  try{
    let count=0;
    for(const s of arr){
      await db.collection("stops").add({
        name:s.name,lineId,lineName:line?line.name:"",city:line?(line.city||"Algerie"):"Algerie",
        lat:s.lat,lng:s.lng,order:count+1,direction:"both",active:true,source:"openstreetmap_geojson",osmId:s.osmId,
        createdAt:now(),updatedAt:now()
      });
      count++;
      setText("osmImportStatus","Import OSM... "+count+"/"+arr.length);
    }
    setText("osmImportStatus","Import terminé ✅ "+count+" arrêts ajoutés.");
    alert("Import OSM terminé ✅");
  }catch(e){
    alert("Erreur import OSM: "+(e.message||e));
    setText("osmImportStatus","Erreur: "+(e.message||e));
  }finally{
    if(btn){btn.disabled=false;btn.textContent="Importer ces arrêts OSM dans Firebase";}
  }
}


async function loadBejaiaLinesStopsGeojson(){
  try{
    const res = await fetch("./data/bejaia-lines-stops.geojson?v=1");
    if(!res.ok) throw new Error("Fichier Bejaia GeoJSON introuvable");
    bejaiaGeojson = await res.json();
    renderBejaiaGeojsonOnMap();
    setText("bejaiaGeojsonStatus", "GeoJSON Béjaïa chargé ✅");
  }catch(e){
    console.warn(e);
    setText("bejaiaGeojsonStatus", "GeoJSON Béjaïa non chargé: " + (e.message || e));
  }
}
function renderBejaiaGeojsonOnMap(){
  if(!map || !bejaiaGeojson) return;
  if(bejaiaGeojsonLayer){
    try{ map.removeLayer(bejaiaGeojsonLayer); }catch(e){}
    bejaiaGeojsonLayer=null;
  }
  const toggle=$("showBejaiaGeojsonToggle");
  if(toggle && !toggle.checked) return;

  bejaiaGeojsonLayer = L.geoJSON(bejaiaGeojson, {
    style:function(feature){
      const p=feature.properties||{};
      if(p.route==="bus" || p.type==="route"){
        return {color:"#7c3aed",weight:5,opacity:.75};
      }
      return {color:"#7c3aed",weight:4,opacity:.55};
    },
    pointToLayer:function(feature,latlng){
      return L.circleMarker(latlng,{radius:6,color:"#fff",weight:2,fillColor:"#f97316",fillOpacity:.95});
    },
    onEachFeature:function(feature,layer){
      const p=feature.properties||{};
      const name=p.name||p.ref||p.local_ref||p.operator||"Élément OSM";
      const type=p.route==="bus"?"Ligne bus":((feature.geometry||{}).type==="Point"?"Arrêt":"Trajet");
      layer.bindPopup(type+": "+name+"<br><small>Source: OpenStreetMap</small>");
    }
  }).addTo(map);
}
function bejaiaStopsFromGeojson(){
  if(!bejaiaGeojson || !Array.isArray(bejaiaGeojson.features)) return [];
  return bejaiaGeojson.features
    .filter(f=>f.geometry&&f.geometry.type==="Point"&&Array.isArray(f.geometry.coordinates))
    .map((f,i)=>{
      const p=f.properties||{}, c=f.geometry.coordinates;
      return {
        name:p.name||p.local_ref||p.ref||("Arrêt Béjaïa OSM "+(i+1)),
        lat:Number(c[1]),
        lng:Number(c[0]),
        osmId:p["@id"]||p.id||f.id||"",
        source:"bejaia_osm_geojson"
      };
    })
    .filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng));
}
function bejaiaLineFeaturesFromGeojson(){
  if(!bejaiaGeojson || !Array.isArray(bejaiaGeojson.features)) return [];
  return bejaiaGeojson.features
    .filter(f=>{
      const g=(f.geometry||{}).type;
      const p=f.properties||{};
      return g==="LineString" || g==="MultiLineString" || p.route==="bus" || p.type==="route";
    });
}
function renderBejaiaImportLineSelect(){
  const sel=$("bejaiaImportLineSelect");
  if(!sel) return;
  const old=sel.value;
  sel.innerHTML='<option value="">Choisir une ligne Firebase...</option>'+lines.map(l=>`<option value="${l.id}">${l.name||l.id}</option>`).join("");
  if([...sel.options].some(o=>o.value===old)) sel.value=old;
}
async function importBejaiaStopsToFirebase(){
  if(!requireAdmin()) return;
  if(!bejaiaGeojson) await loadBejaiaLinesStopsGeojson();
  const lineId=val("bejaiaImportLineSelect");
  if(!lineId) return alert("Choisis une ligne Firebase pour relier les arrêts.");
  const line=lines.find(l=>l.id===lineId);
  const arr=bejaiaStopsFromGeojson();
  if(!arr.length) return alert("Aucun arrêt point dans le GeoJSON.");
  const btn=$("importBejaiaStopsBtn");
  if(btn){btn.disabled=true;btn.textContent="Import Béjaïa...";}
  try{
    let count=0;
    for(const s of arr){
      await db.collection("stops").add({
        name:s.name,lineId,lineName:line?line.name:"",city:line?(line.city||"Bejaia"):"Bejaia",
        lat:s.lat,lng:s.lng,order:count+1,active:true,source:"bejaia_osm_geojson",osmId:s.osmId,
        createdAt:now(),updatedAt:now()
      });
      count++;
      setText("bejaiaGeojsonStatus","Import Béjaïa... "+count+"/"+arr.length);
    }
    setText("bejaiaGeojsonStatus","Import terminé ✅ "+count+" arrêt(s) ajoutés.");
    alert("Import Béjaïa terminé ✅");
  }catch(e){
    alert("Erreur import Béjaïa: "+(e.message||e));
    setText("bejaiaGeojsonStatus","Erreur import: "+(e.message||e));
  }finally{
    if(btn){btn.disabled=false;btn.textContent="Importer les arrêts Béjaïa dans Firebase";}
  }
}
async function createFirebaseLinesFromBejaiaGeojson(){
  if(!requireAdmin()) return;
  if(!bejaiaGeojson) await loadBejaiaLinesStopsGeojson();
  const routeFeatures=bejaiaLineFeaturesFromGeojson();
  if(!routeFeatures.length){
    alert("Le fichier ne contient pas de vraie ligne/route OSM. Il contient surtout des arrêts.");
    setText("bejaiaGeojsonStatus","Aucune ligne/route détectée dans ce GeoJSON.");
    return;
  }
  try{
    let created=0;
    for(const f of routeFeatures){
      const p=f.properties||{};
      const name=p.name||p.ref||("Ligne OSM Béjaïa "+(created+1));
      await db.collection("lines").add({
        name,
        city:"Bejaia",
        type:"bus",
        color:"#7c3aed",
        active:true,
        source:"bejaia_osm_geojson_route",
        osmId:p["@id"]||p.id||f.id||"",
        createdAt:now(),
        updatedAt:now()
      });
      created++;
    }
    setText("bejaiaGeojsonStatus","Créé ✅ "+created+" ligne(s) OSM dans Firebase.");
    alert("Lignes créées ✅");
  }catch(e){
    alert("Erreur création lignes: "+(e.message||e));
  }
}

function initMap(){if(map)return;map=L.map("map").setView([36.7525,5.0843],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map)}
function bindRealtime(){unsub.forEach(f=>f&&f());unsub=[];unsub.push(db.collection("lines").onSnapshot(s=>{lines=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error));unsub.push(db.collection("stops").onSnapshot(s=>{stops=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error));unsub.push(db.collection("vehicles").onSnapshot(s=>{vehicles=s.docs.map(d=>({id:d.id,...d.data()}));renderAll();renderDriverWorkStatus()},console.error));unsub.push(db.collection("drivers").onSnapshot(s=>{drivers=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},console.error))}

function adminFilteredStops(){
  const lineFilterEl = $("adminStopsLineFilter");
  const searchEl = $("adminStopsSearch");
  const lineFilter = lineFilterEl ? lineFilterEl.value : "all";
  const q = searchEl ? (searchEl.value || "").trim().toLowerCase() : "";

  return stops.filter(s => {
    const matchLine = lineFilter === "all" || s.lineId === lineFilter;
    const text = `${s.name || ""} ${getLineName(s.lineId) || ""} ${s.lat || ""} ${s.lng || ""}`.toLowerCase();
    const matchSearch = !q || text.includes(q);
    return matchLine && matchSearch;
  });
}
function renderAdminStopsFilterOptions(){
  const sel = $("adminStopsLineFilter");
  if(!sel) return;
  const old = sel.value || "all";
  sel.innerHTML = '<option value="all">Toutes les lignes</option>' + lines.map(l => `<option value="${l.id}">${l.name || l.id}</option>`).join("");
  sel.value = Array.from(sel.options).some(o => o.value === old) ? old : "all";
}



function stopDirection(s){
  return (s && s.direction) ? s.direction : "both";
}
function directionLabel(d){
  if(d === "aller") return "Aller";
  if(d === "retour") return "Retour";
  return "Aller + Retour";
}
function stopAllowedForDirection(stop, direction){
  const d = stopDirection(stop);
  return d === "both" || d === direction;
}
function lineStopsByDirection(lineId, direction){
  const base = activeStopsOnly().filter(s => s.lineId === lineId && num(s.lat)!==null && num(s.lng)!==null && stopAllowedForDirection(s, direction));
  return base.sort((a,b)=>{
    const oa = Number(a.order || 9999);
    const ob = Number(b.order || 9999);
    if(oa !== ob) return direction === "retour" ? ob - oa : oa - ob;
    return (a.name || "").localeCompare(b.name || "");
  });
}
function bestDirectionForStops(fromStop, toStop){
  if(!fromStop || !toStop || fromStop.lineId !== toStop.lineId) return null;
  const dirs = ["aller","retour"];
  for(const dir of dirs){
    const arr = lineStopsByDirection(fromStop.lineId, dir);
    const fi = arr.findIndex(s => s.id === fromStop.id);
    const ti = arr.findIndex(s => s.id === toStop.id);
    if(fi >= 0 && ti >= 0 && fi <= ti) return dir;
  }
  return null;
}
function vehicleDirection(v){
  return (v && v.direction) ? v.direction : "aller";
}

function isLineActive(lineId){
  const line = lines.find(l => l.id === lineId);
  return !!line && line.active !== false;
}
function activeLinesOnly(){
  return lines.filter(l => l.active !== false);
}
function activeStopsOnly(){
  return stops.filter(s => s.active !== false && isLineActive(s.lineId));
}
async function setLineActive(lineId, active){
  if(!requireAdmin()) return;
  const line = lines.find(l => l.id === lineId);
  if(!line) return alert("Ligne introuvable.");

  const ok = confirm(active
    ? "Réactiver cette ligne et ses arrêts ?"
    : "Désactiver cette ligne et tous ses arrêts ? Elle ne sera plus visible côté client.");
  if(!ok) return;

  try{
    await db.collection("lines").doc(lineId).set({
      active: active,
      updatedAt: now()
    }, {merge:true});

    const relatedStops = stops.filter(s => s.lineId === lineId);
    let batch = db.batch();
    let count = 0;
    for(const s of relatedStops){
      batch.set(db.collection("stops").doc(s.id), {active: active, updatedAt: now()}, {merge:true});
      count++;
      if(count % 400 === 0){
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();

    alert((active ? "Ligne réactivée ✅ " : "Ligne désactivée ✅ ") + count + " arrêt(s) mis à jour.");
  }catch(e){
    console.error(e);
    alert("Erreur activation ligne: " + (e.message || e));
  }
}


// =========================
// TERMINUS + VISIBILITÉ BUS
// =========================
const TERMINUS_RADIUS_METERS = 90;
const LINE_OFF_ROUTE_MAX_METERS = 350;
const BUS_STARTED_MIN_DISTANCE = 120;

function getLineById(lineId){
  return lines.find(l => l.id === lineId) || null;
}
function lineDirectionStops(lineId, direction){
  return lineStopsByDirection ? lineStopsByDirection(lineId, direction || "aller") : activeStopsOnly().filter(s => s.lineId === lineId);
}
function lineStartStop(line, direction){
  if(!line) return null;
  const explicitId = direction === "retour" ? (line.endStopId || line.startStopId) : (line.startStopId || line.endStopId);
  if(explicitId){
    const s = stops.find(x => x.id === explicitId);
    if(s) return s;
  }
  const arr = lineDirectionStops(line.id, direction || "aller");
  return arr[0] || null;
}
function lineEndStop(line, direction){
  if(!line) return null;
  const explicitId = direction === "retour" ? (line.startStopId || line.endStopId) : (line.endStopId || line.startStopId);
  if(explicitId){
    const s = stops.find(x => x.id === explicitId);
    if(s) return s;
  }
  const arr = lineDirectionStops(line.id, direction || "aller");
  return arr[arr.length - 1] || null;
}
function distanceVehicleToStop(v, s){
  if(!v || !s || num(v.lat)===null || num(v.lng)===null || num(s.lat)===null || num(s.lng)===null) return Infinity;
  return distanceMeters(num(v.lat), num(v.lng), num(s.lat), num(s.lng));
}
function isVehicleAtTerminus(v){
  const line = getLineById(v.lineId);
  if(!line) return false;
  const dir = vehicleDirection ? vehicleDirection(v) : (v.direction || "aller");
  const start = lineStartStop(line, dir);
  const end = lineEndStop(line, dir);
  const dStart = distanceVehicleToStop(v, start);
  const dEnd = distanceVehicleToStop(v, end);
  return Math.min(dStart, dEnd) <= TERMINUS_RADIUS_METERS;
}
function nearestDistanceVehicleToLine(v){
  if(!v || num(v.lat)===null || num(v.lng)===null || !v.lineId) return Infinity;
  const dir = vehicleDirection ? vehicleDirection(v) : (v.direction || "aller");
  const arr = lineDirectionStops(v.lineId, dir);
  if(!arr.length) return Infinity;
  let best = Infinity;
  arr.forEach(s => {
    const d = distanceMeters(num(v.lat), num(v.lng), num(s.lat), num(s.lng));
    if(d < best) best = d;
  });
  return best;
}
function isVehicleOffLine(v){
  return nearestDistanceVehicleToLine(v) > LINE_OFF_ROUTE_MAX_METERS;
}
function hasVehicleStartedFromTerminus(v){
  if(!v) return false;
  if(v.started === true) return true;
  const line = getLineById(v.lineId);
  if(!line) return false;
  const dir = vehicleDirection ? vehicleDirection(v) : (v.direction || "aller");
  const start = lineStartStop(line, dir);
  return distanceVehicleToStop(v, start) > BUS_STARTED_MIN_DISTANCE;
}
function enhancedVehicleVisible(v){
  const base = (typeof computeVisibility === "function") ? computeVisibility(v) : {visible:true, reason:""};
  if(!base.visible) return base;

  if(!isLineActive(v.lineId)) return {visible:false, reason:"ligne désactivée"};
  if(isVehicleOffLine(v)) return {visible:false, reason:"hors ligne/tracé"};
  if(isVehicleAtTerminus(v) && !hasVehicleStartedFromTerminus(v)) return {visible:false, reason:"au terminus, pas encore démarré"};

  return {visible:true, reason:"visible"};
}
function renderLineTerminusSelects(){
  const start = $("lineStartStopSelect");
  const end = $("lineEndStopSelect");
  if(!start || !end) return;
  const selectedLineId = editingLineId || "";
  const lineStops = selectedLineId ? stops.filter(s => s.lineId === selectedLineId) : stops;
  const opts = '<option value="">Auto / aucun</option>' + lineStops.map(s => `<option value="${s.id}">${s.name || s.id} · ${getLineName(s.lineId)}</option>`).join("");
  const oldStart = start.value;
  const oldEnd = end.value;
  start.innerHTML = opts;
  end.innerHTML = opts;
  if([...start.options].some(o=>o.value===oldStart)) start.value = oldStart;
  if([...end.options].some(o=>o.value===oldEnd)) end.value = oldEnd;
}

function renderSelects(){renderLineTerminusSelects();renderBejaiaImportLineSelect();renderOsmLineSelect();renderAdminStopsFilterOptions();const city=val("clientCity")||"Bejaia";const vis=lines.filter(l=>!l.city||l.city===city);const old=val("clientLineSelect")||"all";$("clientLineSelect").innerHTML='<option value="all">Toutes les lignes</option>'+vis.map(l=>`<option value="${l.id}">${l.name}</option>`).join("");$("clientLineSelect").value=[...$("clientLineSelect").options].some(o=>o.value===old)?old:"all";const lo=lines.map(l=>`<option value="${l.id}">${l.name}</option>`).join("");$("stopLineSelect").innerHTML=lo;$("vehicleLineSelect").innerHTML=lo;const dro='<option value="">Aucun chauffeur</option>'+drivers.map(d=>`<option value="${d.id}">${d.name||d.email||d.id}</option>`).join("");$("vehicleDriverSelect").innerHTML=dro;$("driverVehicleSelect").innerHTML=vehicles.map(v=>`<option value="${v.id}">${v.name} · ${getLineName(v.lineId)}</option>`).join("")}
function selectedLineStopsForList(){ const sel=val("clientLineSelect")||"all"; return sel==="all" ? stops : stops.filter(s=>s.lineId===sel); }

function orderedStopsForLine(lineId){
  return stops
    .filter(s => s.lineId === lineId && num(s.lat)!==null && num(s.lng)!==null)
    .sort((a,b) => {
      const oa = Number(a.order || 9999);
      const ob = Number(b.order || 9999);
      if(oa !== ob) return oa - ob;
      return (a.name || "").localeCompare(b.name || "");
    });
}
function estimateSpeedKmh(vehicle){
  const s = Number(vehicle.speedKmh || vehicle.speed || 0);
  if(Number.isFinite(s) && s >= 5) return Math.min(s, 70);
  return 25; // vitesse moyenne bus urbain
}
function etaMinutesForVehicleToStop(vehicle, stop){
  if(!vehicle || !stop) return null;
  const vLat = num(vehicle.lat), vLng = num(vehicle.lng), sLat = num(stop.lat), sLng = num(stop.lng);
  if(vLat===null || vLng===null || sLat===null || sLng===null) return null;

  const c = computeVisibility(vehicle);
  if(!c.visible) return null;

  const meters = distanceMeters(vLat, vLng, sLat, sLng);
  const speedMps = estimateSpeedKmh(vehicle) * 1000 / 3600;
  const min = Math.ceil((meters / speedMps) / 60);
  return Math.max(1, min);
}
function nextStopForVehicle(vehicle){
  const lineStops = lineStopsByDirection(vehicle.lineId, vehicleDirection(vehicle));
  if(!lineStops.length) return null;

  let best = null;
  for(const stop of lineStops){
    const eta = etaMinutesForVehicleToStop(vehicle, stop);
    if(eta === null) continue;
    const dist = distanceMeters(num(vehicle.lat), num(vehicle.lng), num(stop.lat), num(stop.lng));
    if(!best || dist < best.distance){
      best = {stop, eta, distance:dist};
    }
  }
  return best;
}
function bestBusForStop(stop){
  const candidates = visibleVehiclesForClients()
    .filter(v => v.lineId === stop.lineId)
    .map(v => ({vehicle:v, eta:etaMinutesForVehicleToStop(v, stop)}))
    .filter(x => x.eta !== null)
    .sort((a,b) => a.eta - b.eta);

  return candidates[0] || null;
}
function renderEtaList(){
  const box = $("etaList");
  if(!box) return;

  const selected = val("clientLineSelect") || "all";
  const lineStops = (selected === "all")
    ? stops.filter(s => num(s.lat)!==null && num(s.lng)!==null)
    : orderedStopsForLine(selected);

  if(!lineStops.length){
    box.innerHTML = '<div class="muted">Aucun arrêt pour calculer l’arrivée.</div>';
    return;
  }

  box.innerHTML = lineStops.map(stop => {
    const best = bestBusForStop(stop);
    if(!best){
      return `<div class="item"><strong>🚏 ${stop.name || "Arrêt"}</strong><span class="muted">${getLineName(stop.lineId)} · Aucun bus en ligne</span></div>`;
    }
    const next = nextStopForVehicle(best.vehicle);
    return `<div class="item etaItem">
      <strong>🚏 ${stop.name || "Arrêt"}</strong>
      <span class="muted">${getLineName(stop.lineId)}</span>
      <div class="etaBadge">🚌 ${best.vehicle.name || "Bus"} arrive dans ${best.eta} min</div>
      <span class="muted">Prochain arrêt du bus: ${next && next.stop ? next.stop.name : "calcul..."}</span>
    </div>`;
  }).join("");
}

function renderLists(){
const sel=val("clientLineSelect")||"all";
const visibleStops = selectedLineStopsForList();

$("linesAdminList").innerHTML=lines.length?lines.map(l=>`<div class="item"><strong>${l.name}</strong><span class="muted">${l.city||""} · ${l.type||"bus"} · Départ: ${stops.find(s=>s.id===l.startStopId)?.name||"auto"} · Arrivée: ${stops.find(s=>s.id===l.endStopId)?.name||"auto"}</span><div class="actions"><button class="editBtn" data-edit-line="${l.id}" type="button">Modifier</button><button class="${l.active===false?`activateBtn`:`disableBtn`}" data-toggle-line="${l.id}" data-active="${l.active===false?`true`:`false`}" type="button">${l.active===false?`Réactiver`:`Désactiver`}</button><button class="deleteBtn" data-del-line="${l.id}" type="button">Supprimer</button></div></div>`).join(""):'<div class="muted">Aucune ligne.</div>';

const adminStops=adminFilteredStops();if($("adminStopsCount"))$("adminStopsCount").textContent=adminStops.length+" arrêt(s) affiché(s)";$("stopsAdminList").innerHTML=adminStops.length?adminStops.map(s=>`<div class="item"><strong>${s.name}</strong><span class="muted">${getLineName(s.lineId)} · ${directionLabel(s.direction||"both")} · ${s.lat}, ${s.lng}</span><div class="actions"><button class="editBtn" data-edit-stop="${s.id}" type="button">Modifier</button><button class="deleteBtn" data-del-stop="${s.id}" type="button">Supprimer</button></div></div>`).join(""):'<div class="muted">Aucun arrêt trouvé.</div>';

$("vehiclesAdminList").innerHTML=vehicles.length?vehicles.map(v=>{const c=enhancedVehicleVisible(v);return `<div class="item"><strong>${v.name}</strong><span class="muted">${getLineName(v.lineId)} · ${driverName(v.driverId)} · ${v.status||"offline"} · ${c.visible?"visible client":"caché client"}</span><div class="actions"><button class="editBtn" data-edit-vehicle="${v.id}" type="button">Modifier</button><button class="deleteBtn" data-del-vehicle="${v.id}" type="button">Supprimer</button></div></div>`}).join(""):'<div class="muted">Aucun véhicule.</div>';

$("driversAdminList").innerHTML=drivers.length?drivers.map(d=>`<div class="item"><strong>${d.name}</strong><span class="muted">${d.phone||""} · ${d.email||""}</span><div class="actions"><button class="editBtn" data-edit-driver="${d.id}" type="button">Modifier</button><button class="deleteBtn" data-del-driver="${d.id}" type="button">Supprimer</button></div></div>`).join(""):'<div class="muted">Aucun chauffeur.</div>';

$("stopsList").innerHTML=visibleStops.length?visibleStops.map(s=>`<div class="item"><strong>🚏 ${s.name}</strong><span class="muted">${getLineName(s.lineId)} · ${directionLabel(s.direction||"both")} · ${s.lat}, ${s.lng}</span></div>`).join(""):'<div class="muted">Aucun arrêt.</div>';

const clientVehicles=visibleVehiclesForClients();
$("vehiclesList").innerHTML=clientVehicles.length?clientVehicles.map(v=>`<div class="item"><strong>🚌 ${v.name}</strong><span class="muted">${getLineName(v.lineId)} · En ligne · GPS récent</span></div>`).join(""):'<div class="muted">Aucun bus en ligne sur sa ligne.</div>';

document.querySelectorAll("[data-edit-line]").forEach(b=>b.onclick=()=>editLine(b.dataset.editLine));
document.querySelectorAll("[data-edit-stop]").forEach(b=>b.onclick=()=>editStop(b.dataset.editStop));
document.querySelectorAll("[data-edit-vehicle]").forEach(b=>b.onclick=()=>editVehicle(b.dataset.editVehicle));
document.querySelectorAll("[data-edit-driver]").forEach(b=>b.onclick=()=>editDriver(b.dataset.editDriver));

document.querySelectorAll("[data-toggle-line]").forEach(b=>b.onclick=()=>setLineActive(b.dataset.toggleLine,b.dataset.active==="true"));
document.querySelectorAll("[data-del-line]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("lines").doc(b.dataset.delLine).delete());
document.querySelectorAll("[data-del-stop]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("stops").doc(b.dataset.delStop).delete());
document.querySelectorAll("[data-del-vehicle]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("vehicles").doc(b.dataset.delVehicle).delete());
document.querySelectorAll("[data-del-driver]").forEach(b=>b.onclick=()=>requireAdmin()&&db.collection("drivers").doc(b.dataset.delDriver).delete())
}

function stopsForLine(lineId){
  if(!lineId || lineId==="all") return [];
  return activeStopsOnly().filter(s => s.lineId === lineId && num(s.lat)!==null && num(s.lng)!==null);
}
function clientVisibleStops(){
  const selected = val("clientLineSelect") || "all";
  if(selected === "all") return activeStopsOnly().filter(s => num(s.lat)!==null && num(s.lng)!==null);
  return stopsForLine(selected);
}
function routeKey(lineId, routeStops){
  return lineId + ":" + routeStops.map(s => `${s.id || s.name}:${s.lat},${s.lng}`).join("|");
}
async function getOsrmRoute(lineId, routeStops){
  if(!routeStops || routeStops.length < 2) return routeStops.map(s => [num(s.lat), num(s.lng)]);
  const key = routeKey(lineId, routeStops);
  if(routeCache[key]) return routeCache[key];

  const coords = routeStops.map(s => `${num(s.lng)},${num(s.lat)}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`;

  try{
    const res = await fetch(url);
    const data = await res.json();
    if(data.code === "Ok" && data.routes && data.routes[0] && data.routes[0].geometry){
      const latlngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      routeCache[key] = latlngs;
      return latlngs;
    }
  }catch(e){
    console.warn("OSRM indisponible, fallback ligne droite", e);
  }

  const fallback = routeStops.map(s => [num(s.lat), num(s.lng)]);
  routeCache[key] = fallback;
  return fallback;
}
async function drawRouteForLine(line, routeStops){
  if(!map || !routeStops || routeStops.length < 2) return;
  const latlngs = await getOsrmRoute(line.id, routeStops);
  const layer = L.polyline(latlngs, {color:line.color||"#2563eb", weight:5, opacity:.70}).addTo(map);
  routeLayers.push(layer);
}
function clearRouteLayers(){
  routeLayers.forEach(layer => { try{ map.removeLayer(layer); }catch(e){} });
  routeLayers = [];
}


function getBusIcon(){
  return L.divIcon({
    className: "busEmojiIcon",
    html: '<div class="busEmojiPin">🚌</div>',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22]
  });
}

async function drawMap(){
if(!map)return;
if(routeFocusActive) return;
if(routeFocusActive) return;
map.eachLayer(layer=>{
  if(layer instanceof L.Marker||layer instanceof L.CircleMarker||layer instanceof L.Polyline) map.removeLayer(layer)
});
clearRouteLayers();

const selected = val("clientLineSelect") || "all";
const visible = clientVisibleStops().filter(s=>s.active!==false && isLineActive(s.lineId));

// Draw stops
visible.forEach(s=>{
  if(num(s.lat)===null || num(s.lng)===null) return;
  const color=lines.find(l=>l.id===s.lineId)?.color||"#2563eb";
  L.circleMarker([num(s.lat),num(s.lng)],{
    radius:8,color,fillColor:color,weight:3,fillOpacity:.9
  }).addTo(map).bindPopup(`🚏 ${s.name}<br>${getLineName(s.lineId)}`);
});

// Draw road routes via OSRM, line by line only
if(selected !== "all"){
  const line = lines.find(l=>l.id===selected);
  const routeStops = stopsForLine(selected);
  if(line && routeStops.length > 1) await drawRouteForLine(line, routeStops);
}else{
  for(const line of lines){
    const routeStops = stopsForLine(line.id);
    if(routeStops.length > 1) await drawRouteForLine(line, routeStops);
  }
}

visibleVehiclesForClients().forEach(v=>{
  if(num(v.lat)===null||num(v.lng)===null) return;
  L.marker([num(v.lat),num(v.lng)], {icon:getBusIcon()})
    .addTo(map)
    .bindPopup(`🚌 ${v.name}<br>${getLineName(v.lineId)}<br>En ligne`);
});

if(clientMarker) clientMarker.addTo(map);
}

function isVehicleWaitingAtTerminus(v){
  if(!v || v.status !== "online") return false;
  if(!isLineActive(v.lineId)) return false;
  if(isVehicleOffLine(v)) return false;
  return isVehicleAtTerminus(v) && !hasVehicleStartedFromTerminus(v);
}
function waitingBusesByLine(){
  const selected = val("clientLineSelect") || "all";
  const result = {};
  vehicles.forEach(v => {
    if(!isVehicleWaitingAtTerminus(v)) return;
    if(selected !== "all" && v.lineId !== selected) return;
    const key = v.lineId || "unknown";
    if(!result[key]) result[key] = {line: getLineById(key), start:0, end:0, total:0, vehicles:[]};
    const line = result[key].line;
    const dir = vehicleDirection ? vehicleDirection(v) : (v.direction || "aller");
    const start = lineStartStop(line, dir);
    const end = lineEndStop(line, dir);
    const dStart = distanceVehicleToStop(v, start);
    const dEnd = distanceVehicleToStop(v, end);
    if(dStart <= dEnd) result[key].start++; else result[key].end++;
    result[key].total++;
    result[key].vehicles.push(v);
  });
  return result;
}
function renderWaitingBusesList(){
  const box = $("waitingBusesList");
  if(!box) return;
  const grouped = waitingBusesByLine();
  const keys = Object.keys(grouped);
  if(!keys.length){
    box.innerHTML = '<div class="muted">Aucun bus en attente au départ ou à l’arrivée.</div>';
    return;
  }
  box.innerHTML = keys.map(lineId => {
    const g = grouped[lineId];
    const line = g.line;
    const color = (line && line.color) || "#64748b";
    return `
      <div class="item waitingBusItem" style="border-left-color:${color}">
        <strong>🚌 ${line ? line.name : lineId}</strong>
        <div class="waitingCount">${g.total} bus en attente</div>
        <span class="muted">Départ: ${g.start} · Arrivée: ${g.end}</span>
      </div>
    `;
  }).join("");
}



function renderAuth(){
  if (typeof renderRoleBadge === 'function') renderRoleBadge();
}

function renderRoleBadge(){
  const b=$("roleBadge");
  if(!b) return;
  if(!currentUser){ b.textContent = guestMode ? "Client invité" : "Non connecté"; return; }
  if(userRole==="admin") b.textContent="Admin";
  else if(userRole==="driver") b.textContent="Chauffeur approuvé";
  else if(userRole==="driver_pending") b.textContent="Chauffeur en attente";
  else b.textContent="Client";
}


// =========================
// ETA BUS RÉEL
// =========================
const ETA_BUS_KMH = 24;
const ETA_WALK_TO_STOP_METERS = 650;

function normalizeCity(x){return (x||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
function etaActiveStops(){
  if(typeof activeStopsOnly === "function") return activeStopsOnly();
  return stops.filter(s => s.active !== false);
}
function etaActiveVehicles(){
  return vehicles.filter(v => {
    const online = v.status === "online" || v.online === true;
    if(!online) return false;
    if(typeof enhancedVehicleVisible === "function") return enhancedVehicleVisible(v).visible;
    if(typeof computeVisibility === "function") return computeVisibility(v).visible;
    return true;
  });
}
function renderEtaStopSelect(){
  const sel = $("etaStopSelect");
  if(!sel) return;
  const old = sel.value;
  const city = val("clientCity") || "";
  const lineId = val("clientLineSelect") || "all";
  let list = etaActiveStops();
  if(city) list = list.filter(s => !s.city || normalizeCity(s.city) === normalizeCity(city));
  if(lineId && lineId !== "all") list = list.filter(s => s.lineId === lineId);
  list = list.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  sel.innerHTML = '<option value="">Choisir un arrêt...</option>' + list.map(s => `<option value="${s.id}">${s.name || s.id} · ${getLineName(s.lineId)}</option>`).join("");
  if([...sel.options].some(o=>o.value===old)) sel.value=old;
}
function etaForStop(stop){
  if(!stop) return null;
  const candidates = etaActiveVehicles()
    .filter(v => v.lineId === stop.lineId && num(v.lat)!==null && num(v.lng)!==null)
    .map(v => {
      const d = distanceMeters(num(v.lat), num(v.lng), num(stop.lat), num(stop.lng));
      const minutes = Math.max(1, Math.round((d / (ETA_BUS_KMH * 1000 / 3600)) / 60));
      return {vehicle:v, distance:d, minutes};
    })
    .sort((a,b)=>a.minutes-b.minutes);
  return candidates[0] || null;
}
function renderEta(){
  const box = $("etaResult");
  if(!box) return;
  const stopId = val("etaStopSelect");
  const stop = stops.find(s => s.id === stopId);
  if(!stop){
    box.innerHTML = "Sélectionne un arrêt.";
    return;
  }
  const eta = etaForStop(stop);
  if(!eta){
    box.innerHTML = `<div class="etaEmpty">Aucun bus en ligne actuellement pour <b>${stop.name}</b>.</div>`;
    return;
  }
  const line = lines.find(l => l.id === stop.lineId);
  const distText = eta.distance >= 1000 ? (eta.distance/1000).toFixed(1)+" km" : Math.round(eta.distance)+" m";
  box.innerHTML = `
    <div class="etaBig">🚌 Arrive dans <b>${eta.minutes} min</b></div>
    <div class="etaMeta">
      Ligne: <b>${line ? line.name : stop.lineId}</b><br>
      Arrêt: <b>${stop.name}</b><br>
      Distance bus → arrêt: <b>${distText}</b>
    </div>
  `;
}

function renderAll(){renderEtaStopSelect();renderRoleBadge();renderPendingDrivers();applyRoleVisibility();renderWaitingBusesList();renderSelects();fillWalkingStopSelectsSafe();renderLists();renderEtaList();renderWalkingTracksAdminSafe();drawMap().catch(console.error)}

async function saveLine(){if(!requireAdmin())return;const btn=$("addLineBtn");btn.disabled=true;btn.textContent=editingLineId?"Mise à jour...":"Enregistrement...";const name=val("lineNameInput").trim();if(!name){btn.disabled=false;btn.textContent=editingLineId?"Mettre à jour ligne":"Ajouter ligne";return alert("Nom ligne obligatoire.")}const data={city:val("lineCity")||"Bejaia",name,type:val("lineType")||"bus",color:val("lineColor")||"#2563eb",active:true};let ok=false;if(editingLineId){ok=await updateDoc("lines",editingLineId,data,"lineStatus")}else{ok=await addDoc("lines",{...data,createdAt:now(),updatedAt:now()},"lineStatus")}if(ok){resetEdit("line")}btn.disabled=false;btn.textContent=editingLineId?"Mettre à jour ligne":"Ajouter ligne"}
async function saveStop(){if(!requireAdmin())return;const btn=$("addStopBtn");btn.disabled=true;btn.textContent=editingStopId?"Mise à jour...":"Enregistrement...";const name=val("stopName").trim(),lat=num(val("stopLat")),lng=num(val("stopLng"));if(!name){btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt";return alert("Nom arrêt obligatoire.")}if(!val("stopLineSelect")){btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt";return alert("Choisis une ligne pour cet arrêt.")}if(lat===null||lng===null){btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt";return alert("Latitude/longitude invalide.")}const data={lineId:val("stopLineSelect"),name,lat,lng,order:Number(val("stopOrder")||0),direction:val("stopDirection")||"both",active:true};let ok=false;if(editingStopId){ok=await updateDoc("stops",editingStopId,data,"stopStatus")}else{ok=await addDoc("stops",{...data,createdAt:now(),updatedAt:now()},"stopStatus")}if(ok){resetEdit("stop")}btn.disabled=false;btn.textContent=editingStopId?"Mettre à jour arrêt":"Ajouter arrêt"}
async function saveVehicle(){if(!requireAdmin())return;const btn=$("addVehicleBtn");btn.disabled=true;btn.textContent=editingVehicleId?"Mise à jour...":"Enregistrement...";const name=val("vehicleName").trim();if(!name){btn.disabled=false;btn.textContent=editingVehicleId?"Mettre à jour véhicule":"Ajouter véhicule";return alert("Nom véhicule obligatoire.")}const data={name,lineId:val("vehicleLineSelect"),driverId:val("vehicleDriverSelect"),active:true};let ok=false;if(editingVehicleId){ok=await updateDoc("vehicles",editingVehicleId,data,"vehicleStatus")}else{ok=await addDoc("vehicles",{...data,status:"offline",visibleToClients:false,lat:null,lng:null,createdAt:now(),updatedAt:now()},"vehicleStatus")}if(ok){resetEdit("vehicle")}btn.disabled=false;btn.textContent=editingVehicleId?"Mettre à jour véhicule":"Ajouter véhicule"}
async function saveDriver(){if(!requireAdmin())return;const btn=$("addDriverBtn");btn.disabled=true;btn.textContent=editingDriverId?"Mise à jour...":"Enregistrement...";const name=val("driverNameAdmin").trim();if(!name){btn.disabled=false;btn.textContent=editingDriverId?"Mettre à jour chauffeur":"Ajouter chauffeur";return alert("Nom chauffeur obligatoire.")}const data={name,phone:val("driverPhoneAdmin").trim(),email:val("driverEmailAdmin").trim(),uid:val("driverEmailAdmin").trim(),active:true};let ok=false;if(editingDriverId){ok=await updateDoc("drivers",editingDriverId,data,"driverAdminStatus")}else{ok=await addDoc("drivers",{...data,createdAt:now(),updatedAt:now()},"driverAdminStatus")}if(ok){resetEdit("driver")}btn.disabled=false;btn.textContent=editingDriverId?"Mettre à jour chauffeur":"Ajouter chauffeur"}
function currentDriverVehicle(){return vehicles.find(v=>v.id===val("driverVehicleSelect"))}
function renderDriverWorkStatus(){const v=currentDriverVehicle();const badge=$("driverWorkBadge");if(!badge)return;if(!v||v.status!=="online"){badge.textContent="Hors ligne";badge.className="workBadge offline";return}const c=enhancedVehicleVisible(v);badge.textContent=c.visible?"En ligne · Visible client":"En ligne · Hors ligne client";badge.className=c.visible?"workBadge online":"workBadge warning"}
async function goOnline(){if(!isDriverApproved()&&!requireAdmin()) return alert("Compte chauffeur pas encore approuvé par admin.");if(!currentUser)return alert("Connecte-toi.");const vehicleId=val("driverVehicleSelect");if(!vehicleId)return alert("Choisis un véhicule.");const v=currentDriverVehicle();if(!v)return alert("Véhicule introuvable.");setText("driverStatus","Demande GPS...");if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);await db.collection("vehicles").doc(vehicleId).set({status:"online",direction:val("driverDirectionSelect")||"aller",started:false,driverId:currentUser.uid,driverName:val("driverNameInput")||currentUser.email,onlineAt:now(),updatedAt:now()}, {merge:true});driverWatchId=navigator.geolocation.watchPosition(async p=>{const t=Date.now();const interval=Number(val("driverGpsFrequency")||30000);if(t-lastGpsWrite<interval)return;lastGpsWrite=t;const temp={...v,lat:p.coords.latitude,lng:p.coords.longitude,status:"online",direction:val("driverDirectionSelect")||"aller",started:false,lastGpsUpdate:t};const c=computeVisibility(temp);try{await db.collection("vehicles").doc(vehicleId).set({lat:p.coords.latitude,lng:p.coords.longitude,status:"online",direction:val("driverDirectionSelect")||"aller",started:false,driverId:currentUser.uid,driverName:val("driverNameInput")||currentUser.email,lastGpsUpdate:firebase.firestore.Timestamp.fromDate(new Date()),speedKmh: p.coords.speed && p.coords.speed > 0 ? Math.round(p.coords.speed*3.6) : estimateSpeedKmh(temp),updatedAt:now(),visibleToClients:c.visible,started: hasVehicleStartedFromTerminus(temp),offRoute:!c.near,distanceFromLineMeters:Math.round(c.distance||0)}, {merge:true});setText("driverStatus",c.visible?"En ligne ✅ visible aux clients":"En ligne mais caché client: hors ligne de bus ou GPS ancien");renderDriverWorkStatus()}catch(e){alert("Erreur GPS Firebase: "+e.message)}},e=>{setText("driverStatus","GPS impossible ou refusé.");alert("GPS impossible ou refusé.")},{enableHighAccuracy:false,timeout:20000,maximumAge:10000});setText("driverStatus","En ligne. GPS démarré.")}
async function goOffline(){const vehicleId=val("driverVehicleSelect");if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);driverWatchId=null;if(vehicleId){await db.collection("vehicles").doc(vehicleId).set({status:"offline",visibleToClients:false,offRoute:false,offlineAt:now(),updatedAt:now()}, {merge:true})}setText("driverStatus","Hors ligne. Le bus est caché aux clients.");renderDriverWorkStatus()}

function clientGps(){if(!navigator.geolocation)return alert("GPS non disponible.");navigator.geolocation.getCurrentPosition(p=>{const lat=p.coords.latitude,lng=p.coords.longitude;map.setView([lat,lng],16);if(clientMarker)clientMarker.setLatLng([lat,lng]);else clientMarker=L.circleMarker([lat,lng],{radius:10,weight:3,fillOpacity:.85}).addTo(map);clientMarker.bindPopup("Ma position").openPopup()},()=>alert("GPS impossible ou refusé."),{enableHighAccuracy:false,timeout:20000,maximumAge:60000})}
function getPosition(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res([p.coords.latitude,p.coords.longitude]),rej,{enableHighAccuracy:false,timeout:20000,maximumAge:60000}):rej(new Error("GPS non disponible")))}
function initStopPicker(){if(stopPickerMap)return;stopPickerMap=L.map("stopPickerMap").setView([36.7525,5.0843],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(stopPickerMap);stopPickerMap.on("click",e=>setPicked(e.latlng.lat,e.latlng.lng))}
function setPicked(lat,lng){pickedLat=lat;pickedLng=lng;if(stopPickerMarker)stopPickerMarker.setLatLng([lat,lng]);else{stopPickerMarker=L.marker([lat,lng],{draggable:true}).addTo(stopPickerMap);stopPickerMarker.on("dragend",()=>{const p=stopPickerMarker.getLatLng();setPicked(p.lat,p.lng)})}setText("pickedCoords",`Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`)}
function openStopPicker(){$("stopPickerModal").classList.remove("hidden");setTimeout(()=>{initStopPicker();const lat=num(val("stopLat"))||36.7525,lng=num(val("stopLng"))||5.0843;stopPickerMap.invalidateSize();stopPickerMap.setView([lat,lng],14);setPicked(lat,lng)},180)}


function normalizeText(txt){
  return (txt || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function findStopsByText(q){
  const n = normalizeText(q);
  if(!n) return [];
  return stops.filter(s => {
    const text = normalizeText(`${s.name || ""} ${getLineName(s.lineId) || ""}`);
    return text.includes(n) || n.includes(normalizeText(s.name || ""));
  });
}
function findLineByText(q){
  const n = normalizeText(q);
  if(!n) return null;
  return lines.find(l => normalizeText(l.name || "").includes(n) || n.includes(normalizeText(l.name || ""))) || null;
}
function fitLineOnMap(lineId){
  const routeStops = typeof stopsForLine === "function" ? stopsForLine(lineId) : stops.filter(s => s.lineId === lineId && num(s.lat)!==null && num(s.lng)!==null);
  if(map && routeStops.length){
    const bounds = L.latLngBounds(routeStops.map(s => [num(s.lat), num(s.lng)]));
    map.fitBounds(bounds, {padding:[35,35]});
  }
}
function searchRouteSmart(){
  const from = val("fromInput").trim();
  const to = val("toInput").trim();
  const selected = val("clientLineSelect") || "all";

  if(!from && !to){
    setText("routeResult","Écris un départ ou une destination.");
    return;
  }

  let fromStops = findStopsByText(from);
  let toStops = findStopsByText(to);

  if(selected !== "all"){
    fromStops = fromStops.filter(s => s.lineId === selected);
    toStops = toStops.filter(s => s.lineId === selected);
  }

  const fromLine = findLineByText(from);
  const toLine = findLineByText(to);

  let foundLineId = null;

  if(fromStops.length && toStops.length){
    const fromIds = new Set(fromStops.map(s => s.lineId));
    const common = toStops.find(s => fromIds.has(s.lineId));
    if(common) foundLineId = common.lineId;
  }

  if(!foundLineId && fromLine) foundLineId = fromLine.id;
  if(!foundLineId && toLine) foundLineId = toLine.id;
  if(!foundLineId && fromStops.length) foundLineId = fromStops[0].lineId;
  if(!foundLineId && toStops.length) foundLineId = toStops[0].lineId;

  if(foundLineId){
    const line = lines.find(l => l.id === foundLineId);
    if($("clientLineSelect")) $("clientLineSelect").value = foundLineId;
    renderAll();
    setTimeout(() => fitLineOnMap(foundLineId), 600);
    const lineStops = stops.filter(s => s.lineId === foundLineId);
    setText("routeResult", `✅ Ligne trouvée: ${line ? line.name : foundLineId} · ${lineStops.length} arrêt(s).`);
    return;
  }

  setText("routeResult","Aucun trajet trouvé. Vérifie que les arrêts ont le bon lineId et que le nom existe.");
}


function clearSearchRouteLayers(){
  routeSearchLayers.forEach(layer => { try{ map.removeLayer(layer); }catch(e){} });
  routeSearchLayers = [];
}
async function getOsrmFootRoute(a,b){
  const learned=approvedWalkingLinkFor(a && a.stop ? a.stop : {}, b && b.stop ? b.stop : {});
  if(learned){
    const learnedRoute=await routeFromApprovedWalkingTrack(learned);
    if(learnedRoute) return learnedRoute;
  }

  if(!a || !b) return {latlngs:[], distance:0, duration:0};
  const key = `walk:${a.lat},${a.lng}:${b.lat},${b.lng}`;
  if(routeCache[key]) return routeCache[key];

  // Public OSRM may not support foot everywhere. We first try foot.
  // If unavailable, we draw a dotted walking line and calculate realistic walking time.
  const footUrl = `https://router.project-osrm.org/route/v1/foot/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;

  try{
    const res = await fetch(footUrl);
    const data = await res.json();
    if(data.code === "Ok" && data.routes && data.routes[0]){
      const route = {
        latlngs: data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
        distance: data.routes[0].distance || distanceMeters(a.lat,a.lng,b.lat,b.lng),
        duration: data.routes[0].duration || distanceMeters(a.lat,a.lng,b.lat,b.lng)/1.25
      };
      routeCache[key]=route;
      return route;
    }
  }catch(e){
    console.warn("OSRM foot unavailable, using pedestrian fallback", e);
  }

  // pedestrian fallback: straight walking segment, NOT car route
  const d = distanceMeters(a.lat,a.lng,b.lat,b.lng);
  const route = {
    latlngs:[[a.lat,a.lng],[b.lat,b.lng]],
    distance:d,
    duration:d/1.25
  };
  routeCache[key]=route;
  return route;
}
function stopPoint(s){ return {lat:num(s.lat), lng:num(s.lng), stop:s}; }
function formatKm(m){ return m >= 1000 ? (m/1000).toFixed(1)+" km" : Math.round(m)+" m"; }
function formatMin(sec){ return Math.max(1, Math.round(sec/60))+" min"; }
function findNearestStopForText(q){
  const found = findStopsByText(q);
  return found.length ? found[0] : null;
}
function findLineStops(lineId){
  return activeStopsOnly().filter(s => s.lineId === lineId && num(s.lat)!==null && num(s.lng)!==null);
}
function findBestTransfer(fromStop, toStop){
  if(!fromStop || !toStop) return null;

  // Direct line always priority
  if(fromStop.lineId === toStop.lineId){
    const busDistance = distanceMeters(num(fromStop.lat),num(fromStop.lng),num(toStop.lat),num(toStop.lng));
    return {type:"direct", lineId:fromStop.lineId, fromStop, toStop, score:busDistance};
  }

  const fromLineStops = findLineStops(fromStop.lineId);
  const toLineStops = findLineStops(toStop.lineId);

  let best = null;
  const MAX_WALK_METERS = 900; // don't propose too long walking transfers

  for(const a of fromLineStops){
    for(const b of toLineStops){
      const walkDistance = distanceMeters(num(a.lat),num(a.lng),num(b.lat),num(b.lng));
      if(walkDistance > MAX_WALK_METERS) continue;

      const bus1 = distanceMeters(num(fromStop.lat),num(fromStop.lng),num(a.lat),num(a.lng));
      const bus2 = distanceMeters(num(b.lat),num(b.lng),num(toStop.lat),num(toStop.lng));

      // Score: prioritize less walking, then shorter global distance.
      // Walking is more expensive than bus because user feels it.
      const score = (walkDistance * 4) + bus1 + bus2;

      if(!best || score < best.score){
        best = {
          type:"transfer",
          fromLineId:fromStop.lineId,
          toLineId:toStop.lineId,
          fromStop,
          toStop,
          transferFrom:a,
          transferTo:b,
          walkDistance,
          busDistance:bus1+bus2,
          score
        };
      }
    }
  }

  // If no transfer under 900m, pick the shortest walking transfer but mark it long
  if(!best){
    for(const a of fromLineStops){
      for(const b of toLineStops){
        const walkDistance = distanceMeters(num(a.lat),num(a.lng),num(b.lat),num(b.lng));
        const bus1 = distanceMeters(num(fromStop.lat),num(fromStop.lng),num(a.lat),num(a.lng));
        const bus2 = distanceMeters(num(b.lat),num(b.lng),num(toStop.lat),num(toStop.lng));
        const score = (walkDistance * 5) + bus1 + bus2;
        if(!best || score < best.score){
          best = {
            type:"transfer",
            fromLineId:fromStop.lineId,
            toLineId:toStop.lineId,
            fromStop,
            toStop,
            transferFrom:a,
            transferTo:b,
            walkDistance,
            busDistance:bus1+bus2,
            score,
            longWalk:true
          };
        }
      }
    }
  }

  return best;
}
async function drawGoogleLikeRoute(plan){
  if(!map || !plan) return;
  clearSearchRouteLayers();

  const boundsPoints = [];

  function addStopMarker(s,label){
    if(!s || num(s.lat)===null || num(s.lng)===null) return;
    const m = L.marker([num(s.lat),num(s.lng)]).addTo(map).bindPopup(label);
    routeSearchLayers.push(m);
    boundsPoints.push([num(s.lat),num(s.lng)]);
  }

  if(plan.type === "direct"){
    const line = lines.find(l=>l.id===plan.lineId);
    const routeStops = findLineStops(plan.lineId);
    if(line && routeStops.length > 1){
      const latlngs = await getOsrmRoute(plan.lineId, routeStops);
      const busLayer = L.polyline(latlngs,{color:line.color||"#2563eb",weight:7,opacity:.85}).addTo(map);
      routeSearchLayers.push(busLayer);
      latlngs.forEach(p=>boundsPoints.push(p));
    }
    addStopMarker(plan.fromStop,"Départ: "+plan.fromStop.name);
    addStopMarker(plan.toStop,"Destination: "+plan.toStop.name);
  }

  if(plan.type === "transfer"){
    const line1 = lines.find(l=>l.id===plan.fromLineId);
    const line2 = lines.find(l=>l.id===plan.toLineId);

    const route1 = findLineStops(plan.fromLineId);
    const route2 = findLineStops(plan.toLineId);

    if(line1 && route1.length > 1){
      const latlngs1 = await getOsrmRoute(plan.fromLineId, route1);
      const layer1 = L.polyline(latlngs1,{color:line1.color||"#2563eb",weight:6,opacity:.75}).addTo(map);
      routeSearchLayers.push(layer1);
      latlngs1.forEach(p=>boundsPoints.push(p));
    }
    if(line2 && route2.length > 1){
      const latlngs2 = await getOsrmRoute(plan.toLineId, route2);
      const layer2 = L.polyline(latlngs2,{color:line2.color||"#16a34a",weight:6,opacity:.75}).addTo(map);
      routeSearchLayers.push(layer2);
      latlngs2.forEach(p=>boundsPoints.push(p));
    }

    const walk = await getOsrmFootRoute(stopPoint(plan.transferFrom), stopPoint(plan.transferTo));
    if(walk && walk.latlngs){
      const walkLayer = L.polyline(walk.latlngs,{color:"#111827",weight:5,opacity:.90,dashArray:"4,12"}).addTo(map);
      routeSearchLayers.push(walkLayer);
      walk.latlngs.forEach(p=>boundsPoints.push(p));
    }

    addStopMarker(plan.fromStop,"Départ: "+plan.fromStop.name);
    addStopMarker(plan.transferFrom,"Descendre ici: "+plan.transferFrom.name);
    addStopMarker(plan.transferTo,"Marcher jusqu’ici: "+plan.transferTo.name);
    addStopMarker(plan.toStop,"Destination: "+plan.toStop.name);
  }

  if(boundsPoints.length){
    map.fitBounds(L.latLngBounds(boundsPoints),{padding:[40,40]});
  }
}
async function searchRouteGoogleLike(){
  const fromTxt = val("fromInput").trim();
  const toTxt = val("toInput").trim();

  if(!fromTxt || !toTxt){
    setText("routeResult","Écris le départ ET la destination.");
    return;
  }

  const fromStop = findNearestStopForText(fromTxt);
  const toStop = findNearestStopForText(toTxt);

  if(!fromStop || !toStop){
    setText("routeResult","Aucun arrêt trouvé. Vérifie le nom du départ et de la destination.");
    return;
  }

  const plan = findBestTransfer(fromStop,toStop);
  if(!plan){
    setText("routeResult","Impossible de calculer un trajet.");
    return;
  }

  if(plan.type === "direct"){
    const line = lines.find(l=>l.id===plan.lineId);
    if($("clientLineSelect")) $("clientLineSelect").value = plan.lineId;
    renderAll();
    await drawGoogleLikeRoute(plan);
    setText("routeResult",`✅ Trajet direct: ${line ? line.name : plan.lineId} · ${fromStop.name} → ${toStop.name}`);
    return;
  }

  if(plan.type === "transfer"){
    const l1 = lines.find(l=>l.id===plan.fromLineId);
    const l2 = lines.find(l=>l.id===plan.toLineId);
    await drawGoogleLikeRoute(plan);
    const walk = await getOsrmFootRoute(stopPoint(plan.transferFrom), stopPoint(plan.transferTo));
    setText("routeResult",`✅ Meilleure correspondance: 🚌 ${l1?l1.name:plan.fromLineId} → 🚶 ${formatKm(walk.distance)} (${formatMin(walk.duration)}) → 🚌 ${l2?l2.name:plan.toLineId}${plan.longWalk ? " · marche longue" : ""}`);
  }
}


function fillWalkingStopSelectsSafe(){
  const from=$("walkFromStopSelect"), to=$("walkToStopSelect");
  if(!from||!to) return;
  const oldFrom=from.value, oldTo=to.value;
  const opts=stops.map(s=>`<option value="${s.id}">${s.name||s.id} · ${getLineName(s.lineId)}</option>`).join("");
  from.innerHTML=opts; to.innerHTML=opts;
  if([...from.options].some(o=>o.value===oldFrom)) from.value=oldFrom;
  if([...to.options].some(o=>o.value===oldTo)) to.value=oldTo;
}
function approvedWalkingLinkFor(a,b){
  if(!a||!b) return null;
  return walkingTracks.find(t => t.approved===true && (
    (t.fromStopId===a.id && t.toStopId===b.id) || (t.fromStopId===b.id && t.toStopId===a.id)
  ));
}
async function routeFromApprovedWalkingTrack(track){
  if(track && Array.isArray(track.points) && track.points.length>=2){
    return {
      latlngs: track.points.map(p=>[Number(p.lat),Number(p.lng)]),
      distance: track.distanceMeters||0,
      duration: track.durationSeconds||0,
      learned:true
    };
  }
  return null;
}
function walkingTrackDistance(points){
  let total=0;
  for(let i=1;i<points.length;i++){
    total += distanceMeters(points[i-1].lat,points[i-1].lng,points[i].lat,points[i].lng);
  }
  return total;
}
function startWalkingTrack(){
  const fromId=val("walkFromStopSelect"), toId=val("walkToStopSelect");
  if(!fromId||!toId||fromId===toId) return alert("Choisis deux arrêts différents.");
  if(!navigator.geolocation) return alert("GPS non disponible.");
  walkingTrackPoints=[]; walkingTrackStart=Date.now();
  if(walkingTrackWatchId) navigator.geolocation.clearWatch(walkingTrackWatchId);
  setText("walkingTrackStatus","Enregistrement du chemin à pied...");
  walkingTrackWatchId=navigator.geolocation.watchPosition(pos=>{
    const p={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy||null,t:Date.now()};
    const last=walkingTrackPoints[walkingTrackPoints.length-1];
    if(!last || distanceMeters(last.lat,last.lng,p.lat,p.lng)>5){
      walkingTrackPoints.push(p);
      setText("walkingTrackStatus",`Enregistrement... ${walkingTrackPoints.length} points GPS`);
    }
  },()=>{setText("walkingTrackStatus","GPS impossible.");alert("GPS impossible.");},{enableHighAccuracy:true,timeout:20000,maximumAge:2000});
}
async function stopWalkingTrack(){
  if(walkingTrackWatchId) navigator.geolocation.clearWatch(walkingTrackWatchId);
  walkingTrackWatchId=null;
  const fromId=val("walkFromStopSelect"), toId=val("walkToStopSelect");
  if(!fromId||!toId||fromId===toId) return alert("Choisis deux arrêts différents.");
  if(walkingTrackPoints.length<2) return alert("Pas assez de points GPS.");
  const fromStop=stops.find(s=>s.id===fromId), toStop=stops.find(s=>s.id===toId);
  const durationSeconds=Math.round((Date.now()-walkingTrackStart)/1000);
  const distanceMetersValue=Math.round(walkingTrackDistance(walkingTrackPoints));
  try{
    await db.collection("walkingTracks").add({
      fromStopId:fromId,toStopId:toId,
      fromStopName:fromStop?fromStop.name:"",toStopName:toStop?toStop.name:"",
      distanceMeters:distanceMetersValue,durationSeconds,
      points:walkingTrackPoints.map(p=>({lat:p.lat,lng:p.lng,t:p.t,accuracy:p.accuracy})),
      approved:false,active:true,createdAt:now()
    });
    setText("walkingTrackStatus",`Envoyé ✅ ${distanceMetersValue} m · ${formatMin(durationSeconds)}. En attente validation admin.`);
    walkingTrackPoints=[];
  }catch(e){alert("Erreur envoi chemin: "+(e.message||e));}
}
function renderWalkingTracksAdminSafe(){
  const box=$("walkingTracksAdminList"); if(!box) return;
  box.innerHTML=walkingTracks.length?walkingTracks.map(t=>`
    <div class="item">
      <strong>🚶 ${t.fromStopName||t.fromStopId} → ${t.toStopName||t.toStopId}</strong>
      <span class="muted">${formatKm(t.distanceMeters||0)} · ${formatMin(t.durationSeconds||0)} · ${t.approved?"validé ✅":"à valider ⏳"}</span>
      <div class="actions">
        <button class="editBtn" data-approve-walk="${t.id}" type="button">Valider</button>
        <button class="deleteBtn" data-delete-walk="${t.id}" type="button">Supprimer</button>
      </div>
    </div>`).join(""):'<div class="muted">Aucun chemin proposé.</div>';
  document.querySelectorAll("[data-approve-walk]").forEach(b=>b.onclick=async()=>{if(!requireAdmin())return;await db.collection("walkingTracks").doc(b.dataset.approveWalk).set({approved:true,active:true,approvedAt:now()},{merge:true});});
  document.querySelectorAll("[data-delete-walk]").forEach(b=>b.onclick=async()=>{if(!requireAdmin())return;await db.collection("walkingTracks").doc(b.dataset.deleteWalk).delete();});
}


const ALGERIA_IMPORT_EXAMPLE = {
  "lines": [
    {
      "name": "Tidjounane - Takarietz",
      "city": "Bejaia",
      "type": "bus",
      "color": "#2563eb",
      "stops": [
        {"name":"Sidi Aïch Centre", "lat":36.6122, "lng":4.6865},
        {"name":"Gare Sidi Aïch", "lat":36.6110, "lng":4.6880},
        {"name":"Takarietz", "lat":36.5840, "lng":4.7200},
        {"name":"Tidjounane", "lat":36.5700, "lng":4.7400}
      ]
    },
    {
      "name": "Béjaïa Centre - Université",
      "city": "Bejaia",
      "type": "bus",
      "color": "#16a34a",
      "stops": [
        {"name":"Béjaïa Centre", "lat":36.7525, "lng":5.0843},
        {"name":"Gare routière", "lat":36.7509, "lng":5.0567},
        {"name":"Université", "lat":36.7165, "lng":5.0614}
      ]
    }
  ]
};

function setImportStatus(msg){
  setText("importStatus", msg);
}
function validateImportData(data){
  if(!data || !Array.isArray(data.lines)) throw new Error("Le JSON doit contenir: lines: []");
  data.lines.forEach((line, i) => {
    if(!line.name) throw new Error("Ligne #" + (i+1) + " sans name");
    if(!Array.isArray(line.stops) || !line.stops.length) throw new Error("Ligne " + line.name + " sans stops");
    line.stops.forEach((stop, j) => {
      if(!stop.name) throw new Error("Arrêt #" + (j+1) + " sans name dans " + line.name);
      if(!Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lng))) {
        throw new Error("Arrêt " + stop.name + " latitude/longitude invalide");
      }
    });
  });
}
async function importAlgeriaLines(){
  if(!requireAdmin()) return;
  const textarea = $("importJsonText");
  if(!textarea) return;

  let data;
  try{
    data = JSON.parse(textarea.value);
    validateImportData(data);
  }catch(e){
    setImportStatus("Erreur JSON: " + (e.message || e));
    alert("Erreur JSON: " + (e.message || e));
    return;
  }

  const btn = $("importLinesBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Import en cours..."; }

  try{
    let lineCount = 0;
    let stopCount = 0;

    for(const line of data.lines){
      const lineRef = await db.collection("lines").add({
        name: line.name,
        city: line.city || "Algerie",
        type: line.type || "bus",
        color: line.color || "#2563eb",
        active: line.active !== false,
        source: line.source || "import_admin",
        createdAt: now(),
        updatedAt: now()
      });
      lineCount++;

      for(let i=0;i<line.stops.length;i++){
        const stop = line.stops[i];
        await db.collection("stops").add({
          name: stop.name,
          lineId: lineRef.id,
          lineName: line.name,
          city: line.city || "Algerie",
          lat: Number(stop.lat),
          lng: Number(stop.lng),
          order: Number(stop.order || (i+1)),
          direction: stop.direction || "both",
          active: stop.active !== false,
          source: stop.source || "import_admin",
          createdAt: now(),
          updatedAt: now()
        });
        stopCount++;
      }
      setImportStatus(`Import... ${lineCount} ligne(s), ${stopCount} arrêt(s)`);
    }

    setImportStatus(`Import terminé ✅ ${lineCount} ligne(s), ${stopCount} arrêt(s) créés dans Firebase.`);
    alert("Import terminé ✅");
  }catch(e){
    console.error(e);
    setImportStatus("Erreur import Firebase: " + (e.message || e));
    alert("Erreur import Firebase: " + (e.message || e));
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = "Importer dans Firebase"; }
  }
}
function loadExampleImport(){
  const t = $("importJsonText");
  if(t) t.value = JSON.stringify(ALGERIA_IMPORT_EXAMPLE, null, 2);
  setImportStatus("Exemple chargé. Tu peux modifier les noms/coordonnées puis importer.");
}


const AUTO_LINE_COLORS = ["#2563eb","#16a34a","#dc2626","#9333ea","#f59e0b","#0891b2","#db2777","#22c55e","#f97316","#4f46e5","#0f766e","#be123c"];

function geoDistanceMeters(lat1,lng1,lat2,lng2){
  return distanceMeters(Number(lat1),Number(lng1),Number(lat2),Number(lng2));
}
function featureCoords(feature){
  const g = feature.geometry || {};
  if(g.type === "LineString") return g.coordinates || [];
  if(g.type === "MultiLineString") return (g.coordinates || []).flat();
  return [];
}
function featureCenter(feature){
  const coords = featureCoords(feature);
  if(!coords.length) return null;
  let lat=0,lng=0;
  coords.forEach(c => { lng += Number(c[0]); lat += Number(c[1]); });
  return {lat:lat/coords.length,lng:lng/coords.length};
}
function nearestDistancePointToFeature(stop, feature){
  const coords = featureCoords(feature);
  if(!coords.length) return Infinity;
  let best = Infinity;
  coords.forEach(c => {
    const d = geoDistanceMeters(stop.lat, stop.lng, Number(c[1]), Number(c[0]));
    if(d < best) best = d;
  });
  return best;
}
function bejaiaAllStopsFromGeojson(){
  if(!bejaiaGeojson || !Array.isArray(bejaiaGeojson.features)) return [];
  return bejaiaGeojson.features
    .filter(f => f.geometry && f.geometry.type === "Point" && Array.isArray(f.geometry.coordinates))
    .map((f,i) => {
      const p=f.properties||{}, c=f.geometry.coordinates;
      return {
        index:i,
        name:p.name || p.local_ref || p.ref || ("Arrêt OSM " + (i+1)),
        lat:Number(c[1]),
        lng:Number(c[0]),
        osmId:p["@id"] || p.id || f.id || "",
        props:p
      };
    })
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
}
function bejaiaRouteFeaturesOnly(){
  if(!bejaiaGeojson || !Array.isArray(bejaiaGeojson.features)) return [];
  const routes = bejaiaGeojson.features.filter(f => {
    const g=(f.geometry||{}).type;
    const p=f.properties||{};
    return g==="LineString" || g==="MultiLineString" || p.route==="bus" || p.type==="route";
  });
  // Deduplicate by name/ref + geometry type
  const seen = new Set();
  return routes.filter((f,i) => {
    const p=f.properties||{};
    const name=p.name || p.ref || p["@id"] || f.id || ("route-"+i);
    const key = String(name) + "|" + ((f.geometry||{}).type);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function routeDisplayName(feature, index){
  const p=feature.properties||{};
  return p.name || p.ref || p.operator || ("Ligne OSM Béjaïa " + (index+1));
}
function assignStopsToRoutes(routeFeatures, stopsList){
  const assignments = new Map();
  const maxDistance = 250; // meters from line geometry
  routeFeatures.forEach((route, routeIndex) => {
    assignments.set(routeIndex, []);
  });

  const unassigned = [];

  stopsList.forEach(stop => {
    let bestRouteIndex = -1;
    let bestDistance = Infinity;

    routeFeatures.forEach((route, idx) => {
      const d = nearestDistancePointToFeature(stop, route);
      if(d < bestDistance){
        bestDistance = d;
        bestRouteIndex = idx;
      }
    });

    if(bestRouteIndex >= 0 && bestDistance <= maxDistance){
      assignments.get(bestRouteIndex).push({...stop, distanceToRoute:Math.round(bestDistance)});
    }else{
      unassigned.push(stop);
    }
  });

  // Sort stops inside each route by nearest point order approximation:
  // use distance from route center then fallback name
  routeFeatures.forEach((route, idx) => {
    const coords = featureCoords(route);
    assignments.get(idx).sort((a,b) => {
      if(coords.length){
        const first = coords[0];
        const da = geoDistanceMeters(a.lat,a.lng,Number(first[1]),Number(first[0]));
        const db = geoDistanceMeters(b.lat,b.lng,Number(first[1]),Number(first[0]));
        return da-db;
      }
      return (a.name||"").localeCompare(b.name||"");
    });
  });

  return {assignments, unassigned};
}
async function importBejaiaAutoLinesAndStops(){
  if(!requireAdmin()) return;
  if(!bejaiaGeojson) await loadBejaiaLinesStopsGeojson();

  const routeFeatures = bejaiaRouteFeaturesOnly();
  const stopsList = bejaiaAllStopsFromGeojson();

  if(!stopsList.length){
    alert("Aucun arrêt dans le GeoJSON.");
    return;
  }

  const btn = $("autoImportBejaiaBtn");
  if(btn){btn.disabled=true;btn.textContent="Import automatique...";}

  try{
    const {assignments, unassigned} = assignStopsToRoutes(routeFeatures, stopsList);
    let linesCreated = 0;
    let stopsCreated = 0;


  if(!routeFeatures.length){
    const lineRef = await db.collection("lines").add({
      name:"Béjaïa OSM - Arrêts importés",
      city:"Bejaia",
      type:"bus",
      color:AUTO_LINE_COLORS[0],
      active:true,
      source:"bejaia_osm_auto_no_routes",
      createdAt:now(),
      updatedAt:now()
    });
    linesCreated++;
    for(let i=0;i<stopsList.length;i++){
      const s=stopsList[i];
      await db.collection("stops").add({
        name:s.name,lineId:lineRef.id,lineName:"Béjaïa OSM - Arrêts importés",city:"Bejaia",
        lat:s.lat,lng:s.lng,order:i+1,direction:"both",active:true,source:"bejaia_osm_auto_no_routes",osmId:s.osmId,
        createdAt:now(),updatedAt:now()
      });
      stopsCreated++;
    }
    setText("bejaiaGeojsonStatus", `Import automatique terminé ✅ ${linesCreated} ligne, ${stopsCreated} arrêts.`);
    alert("Import automatique terminé ✅");
    return;
  }


    if(routeFeatures.length){
      for(let i=0;i<routeFeatures.length;i++){
        const route = routeFeatures[i];
        const color = AUTO_LINE_COLORS[i % AUTO_LINE_COLORS.length];
        const p = route.properties || {};
        const selectedLineName = routeDisplayName(route, i);
        const routeStops = assignments.get(i) || [];

        // Create only useful line if it has stops or geometry
        const lineRef = await db.collection("lines").add({
          name: lineName,
          city: "Bejaia",
          type: "bus",
          color,
          active: true,
          source: "bejaia_osm_auto",
          routeGeometryType: ((route.geometry||{}).type || null),
          osmId: p["@id"] || p.id || route.id || "",
          routeGeometry: null,
          createdAt: now(),
          updatedAt: now()
        });
        linesCreated++;

        for(let j=0;j<routeStops.length;j++){
          const s = routeStops[j];
          await db.collection("stops").add({
            name: s.name,
            lineId: lineRef.id,
            lineName,
            city: "Bejaia",
            lat: s.lat,
            lng: s.lng,
            order: j+1,
            direction:"both",
            active: true,
            source: "bejaia_osm_auto",
          routeGeometryType: ((route.geometry||{}).type || null),
            osmId: s.osmId,
            distanceToRoute: s.distanceToRoute || null,
            createdAt: now(),
            updatedAt: now()
          });
          stopsCreated++;
        }
        setText("bejaiaGeojsonStatus", `Import auto... ${linesCreated} ligne(s), ${stopsCreated} arrêt(s)`);
      }
    }

    if(unassigned.length){
      const lineRef = await db.collection("lines").add({
        name: "Arrêts Béjaïa non classés",
        city: "Bejaia",
        type: "bus",
        color: "#64748b",
        active: true,
        source: "bejaia_osm_unassigned",
        createdAt: now(),
        updatedAt: now()
      });
      linesCreated++;
      for(let k=0;k<unassigned.length;k++){
        const s = unassigned[k];
        await db.collection("stops").add({
          name: s.name,
          lineId: lineRef.id,
          lineName: "Arrêts Béjaïa non classés",
          city: "Bejaia",
          lat: s.lat,
          lng: s.lng,
          order: k+1,
          active: true,
          source: "bejaia_osm_unassigned",
          osmId: s.osmId,
          createdAt: now(),
          updatedAt: now()
        });
        stopsCreated++;
      }
    }

    setText("bejaiaGeojsonStatus", `Import automatique terminé ✅ ${linesCreated} ligne(s), ${stopsCreated} arrêt(s). Couleurs attribuées automatiquement.`);
    alert("Import automatique terminé ✅");
  }catch(e){
    console.error(e);
    setText("bejaiaGeojsonStatus", "Erreur import auto: " + (e.message || e));
    alert("Erreur import auto: " + (e.message || e));
  }finally{
    if(btn){btn.disabled=false;btn.textContent="Importer lignes + arrêts automatiquement";}
  }
}


async function deleteCollectionByQuery(collectionName, statusId){
  const snap = await db.collection(collectionName).get();
  let count = 0;
  const batchSize = 400;
  let batch = db.batch();
  for(const doc of snap.docs){
    batch.delete(doc.ref);
    count++;
    if(count % batchSize === 0){
      await batch.commit();
      batch = db.batch();
      setText(statusId, `Suppression ${collectionName}... ${count}`);
    }
  }
  await batch.commit();
  return count;
}
async function deleteAllLinesAndStops(){
  if(!requireAdmin()) return;
  const ok1 = confirm("Supprimer TOUTES les lignes et TOUS les arrêts dans Firebase ?");
  if(!ok1) return;
  const ok2 = confirm("Confirmation finale: cette action est irréversible. Continuer ?");
  if(!ok2) return;

  const btn = $("deleteAllLinesStopsBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Suppression..."; }

  try{
    setText("bejaiaGeojsonStatus", "Suppression des arrêts...");
    const stopsDeleted = await deleteCollectionByQuery("stops", "bejaiaGeojsonStatus");

    setText("bejaiaGeojsonStatus", "Suppression des lignes...");
    const linesDeleted = await deleteCollectionByQuery("lines", "bejaiaGeojsonStatus");

    setText("bejaiaGeojsonStatus", `Suppression terminée ✅ ${linesDeleted} lignes, ${stopsDeleted} arrêts supprimés.`);
    alert("Suppression terminée ✅");
  }catch(e){
    console.error(e);
    setText("bejaiaGeojsonStatus", "Erreur suppression: " + (e.message || e));
    alert("Erreur suppression: " + (e.message || e));
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = "⚠️ Supprimer toutes les lignes et tous les arrêts Firebase"; }
  }
}



function getLineName(id){
  const line = (typeof lines !== "undefined" ? lines : []).find(l => l.id === id);
  return line ? (line.name || "Ligne inconnue") : "Ligne inconnue";
}

function normalizeSearchText(txt){
  return (txt || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
}
function searchStopsEverywhere(q){
  const nq=normalizeSearchText(q);
  if(!nq) return [];
  const words=nq.split(" ").filter(Boolean);
  return stops.filter(s=>{
    const text=normalizeSearchText(`${s.name||""} ${s.lineName||""} ${getLineName(s.lineId)||""} ${s.city||""}`);
    return text.includes(nq) || words.every(w=>text.includes(w));
  }).map(s=>{
    const text=normalizeSearchText(`${s.name||""} ${s.lineName||""} ${getLineName(s.lineId)||""} ${s.city||""}`);
    let score=0;
    if(text.includes(nq)) score+=100;
    words.forEach(w=>{if(text.includes(w)) score+=10});
    if(normalizeSearchText(s.name||"").includes(nq)) score+=50;
    return {...s,_score:score};
  }).sort((a,b)=>b._score-a._score);
}
function bestStopMatch(q){return searchStopsEverywhere(q)[0]||null;}
function safeClearSearchLayers(){
  if(Array.isArray(routeSearchLayers)){
    routeSearchLayers.forEach(layer=>{try{map.removeLayer(layer)}catch(e){}});
    routeSearchLayers=[];
  }
}
function safeOrderedStops(lineId){
  if(typeof orderedStopsForLine==="function") return orderedStopsForLine(lineId);
  return activeStopsOnly().filter(s=>s.lineId===lineId&&num(s.lat)!==null&&num(s.lng)!==null);
}
function findClosestTransferBetweenLines(fromStop,toStop){
  if(!fromStop||!toStop||!fromStop.lineId||!toStop.lineId) return null;
  const fromStops=safeOrderedStops(fromStop.lineId);
  const toStops=safeOrderedStops(toStop.lineId);
  let best=null;
  for(const a of fromStops){
    for(const b of toStops){
      const d=distanceMeters(num(a.lat),num(a.lng),num(b.lat),num(b.lng));
      if(!best||d<best.walkDistance) best={fromLineId:fromStop.lineId,toLineId:toStop.lineId,transferFrom:a,transferTo:b,walkDistance:d};
    }
  }
  return best;
}
async function drawSimpleRouteResult(fromStop,toStop,transfer){
  if(!map) return;
  routeFocusActive = true;
  cleanMapForRouteOnly();
  safeClearSearchLayers();
  const pts=[];
  function addMarker(s,label){
    if(!s||num(s.lat)===null||num(s.lng)===null) return;
    const m=L.marker([num(s.lat),num(s.lng)]).addTo(map).bindPopup(label);
    routeSearchLayers.push(m); pts.push([num(s.lat),num(s.lng)]);
  }
  addMarker(fromStop,"Départ: "+(fromStop.name||""));
  addMarker(toStop,"Destination: "+(toStop.name||""));
  for(const lineId of [...new Set([fromStop.lineId,toStop.lineId].filter(Boolean))]){
    const line=lines.find(l=>l.id===lineId);
    const lineStops=safeOrderedStops(lineId);
    if(lineStops.length>1){
      const latlngs=await getOsrmRoute(lineId,lineStops);
      const layer=L.polyline(latlngs,{color:(line&&line.color)||"#2563eb",weight:6,opacity:.75}).addTo(map);
      routeSearchLayers.push(layer); latlngs.forEach(p=>pts.push(p));
    }
  }
  if(transfer&&transfer.transferFrom&&transfer.transferTo){
    addMarker(transfer.transferFrom,"Descendre: "+transfer.transferFrom.name);
    addMarker(transfer.transferTo,"Reprendre: "+transfer.transferTo.name);
    const walk=[[num(transfer.transferFrom.lat),num(transfer.transferFrom.lng)],[num(transfer.transferTo.lat),num(transfer.transferTo.lng)]];
    const walkLayer=L.polyline(walk,{color:"#111827",weight:5,opacity:.9,dashArray:"4,12"}).addTo(map);
    routeSearchLayers.push(walkLayer); walk.forEach(p=>pts.push(p));
  }
  if(pts.length) map.fitBounds(L.latLngBounds(pts),{padding:[40,40]});
}
async function searchRouteFixedAllStops(){
  const fromTxt=val("fromInput").trim();
  const toTxt=val("toInput").trim();
  if(!fromTxt||!toTxt){setText("routeResult","Écris le départ ET la destination.");return;}
  const fromStop=bestStopMatch(fromTxt);
  const toStop=bestStopMatch(toTxt);
  if(!fromStop||!toStop){
    const f=searchStopsEverywhere(fromTxt).slice(0,3).map(s=>s.name).join(", ");
    const t=searchStopsEverywhere(toTxt).slice(0,3).map(s=>s.name).join(", ");
    setText("routeResult",`Aucun trajet trouvé. Départ trouvé: ${f||"non"} · Destination trouvée: ${t||"non"}`);
    return;
  }
  if(fromStop.lineId&&toStop.lineId&&fromStop.lineId===toStop.lineId){
    if($("clientLineSelect")) $("clientLineSelect").value=fromStop.lineId;
    renderAll();
    await drawSimpleRouteResult(fromStop,toStop,null);
    setText("routeResult",`✅ Trajet direct: ${getLineName(fromStop.lineId)} · ${fromStop.name} → ${toStop.name}`);
    return;
  }
  const transfer=findClosestTransferBetweenLines(fromStop,toStop);
  await drawSimpleRouteResult(fromStop,toStop,transfer);
  if(transfer){
    const walkMin=Math.max(1,Math.round((transfer.walkDistance/1.25)/60));
    setText("routeResult",`✅ Trajet avec correspondance: ${getLineName(fromStop.lineId)} → 🚶 ${Math.round(transfer.walkDistance)} m (${walkMin} min) → ${getLineName(toStop.lineId)}`);
  }else{
    setText("routeResult",`✅ Arrêts trouvés: ${fromStop.name} → ${toStop.name}. Pas de correspondance calculée.`);
  }
}


// =========================
// MULTI-LIGNES PATHFINDING
// =========================
const MULTI_WALK_LIMIT_METERS = 850;
const MULTI_TRANSFER_LIMIT_METERS = 550;
const BUS_AVG_KMH = 25;
const WALK_MPS = 1.25;

function ensureSearchHelpers(){
  if(typeof normalizeSearchText !== "function"){
    window.normalizeSearchText = function(txt){
      return (txt || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
    };
  }
}
function stopLabel(s){
  return s ? (s.name || s.id || "Arrêt") : "Arrêt";
}
function allValidStops(){
  return activeStopsOnly().filter(s => s && s.id && s.lineId && num(s.lat)!==null && num(s.lng)!==null);
}
function routeLineStops(lineId, direction="aller"){
  return lineStopsByDirection(lineId, direction);
}
function uniqueStopKey(stop){
  return stop.id;
}
function buildTransportGraph(){
  const graph = {};
  const valid = allValidStops();

  valid.forEach(s => { graph[uniqueStopKey(s)] = []; });

  // Bus edges along each line, forward and backward
  activeLinesOnly().forEach(line => {
    ["aller","retour"].forEach(direction => {
      const ls = routeLineStops(line.id, direction);
      for(let i=0;i<ls.length-1;i++){
        const a=ls[i], b=ls[i+1];
        const d=distanceMeters(num(a.lat),num(a.lng),num(b.lat),num(b.lng));
        const minutes = (d / (BUS_AVG_KMH*1000/3600)) / 60;
        const cost = minutes + 0.5;
        graph[uniqueStopKey(a)].push({to:uniqueStopKey(b), type:"bus", lineId:line.id, direction, distance:d, minutes, cost});
      }
    });
  });

  // Walking transfer edges only for close stops, never huge walks
  for(let i=0;i<valid.length;i++){
    for(let j=i+1;j<valid.length;j++){
      const a=valid[i], b=valid[j];
      if(a.lineId === b.lineId) continue;
      const d=distanceMeters(num(a.lat),num(a.lng),num(b.lat),num(b.lng));
      if(d <= MULTI_TRANSFER_LIMIT_METERS){
        const minutes = (d / WALK_MPS) / 60;
        const cost = minutes * 1.8 + 4; // walking + transfer penalty
        graph[uniqueStopKey(a)].push({to:uniqueStopKey(b), type:"walk", lineId:null, distance:d, minutes, cost});
        graph[uniqueStopKey(b)].push({to:uniqueStopKey(a), type:"walk", lineId:null, distance:d, minutes, cost});
      }
    }
  }

  return graph;
}
function dijkstraRoute(startId, endId){
  const graph = buildTransportGraph();
  const dist = {}, prev = {}, visited = new Set();
  Object.keys(graph).forEach(k => dist[k] = Infinity);
  dist[startId] = 0;

  while(true){
    let u = null, best = Infinity;
    for(const k of Object.keys(dist)){
      if(!visited.has(k) && dist[k] < best){
        best = dist[k]; u = k;
      }
    }
    if(u === null) break;
    if(u === endId) break;
    visited.add(u);

    for(const edge of (graph[u] || [])){
      const alt = dist[u] + edge.cost;
      if(alt < dist[edge.to]){
        dist[edge.to] = alt;
        prev[edge.to] = {from:u, edge};
      }
    }
  }

  if(!prev[endId] && startId !== endId) return null;

  const path = [];
  let cur = endId;
  while(cur !== startId){
    const p = prev[cur];
    if(!p) return null;
    path.unshift({from:p.from, to:cur, edge:p.edge});
    cur = p.from;
  }
  return {cost:dist[endId], path};
}
function compactSegments(path){
  const stopById = Object.fromEntries(stops.map(s => [s.id,s]));
  const segments = [];
  for(const step of path){
    const fromStop = stopById[step.from];
    const toStop = stopById[step.to];
    if(!fromStop || !toStop) continue;

    const last = segments[segments.length-1];
    if(last && last.type === step.edge.type && last.lineId === step.edge.lineId && last.direction === step.edge.direction){
      last.to = toStop;
      last.toId = toStop.id;
      last.distance += step.edge.distance;
      last.minutes += step.edge.minutes;
      last.stops.push(toStop);
    }else{
      segments.push({
        type:step.edge.type,
        lineId:step.edge.lineId,
        direction:step.edge.direction || null,
        from:fromStop,
        to:toStop,
        fromId:fromStop.id,
        toId:toStop.id,
        distance:step.edge.distance,
        minutes:step.edge.minutes,
        stops:[fromStop,toStop]
      });
    }
  }
  return segments;
}
function routeSummaryText(segments){
  if(!segments.length) return "Aucun trajet.";
  return segments.map(seg=>{
    if(seg.type === "bus"){
      return `🚌 ${getLineName(seg.lineId)} · ${directionLabel(seg.direction||"aller")} (${Math.max(1,Math.round(seg.minutes))} min)`;
    }
    return `🚶 ${Math.round(seg.distance)} m (${Math.max(1,Math.round(seg.minutes))} min)`;
  }).join(" → ");
}
function routeTotals(segments){
  let walk=0,bus=0,min=0,transfers=0,lastBus=null;
  segments.forEach(seg=>{
    min += seg.minutes;
    if(seg.type==="walk") walk += seg.distance;
    if(seg.type==="bus"){
      bus += seg.distance;
      if(lastBus && lastBus !== seg.lineId) transfers++;
      lastBus = seg.lineId;
    }
  });
  return {walk,bus,min,transfers};
}
function clearMultiRouteLayers(){
  if(!Array.isArray(routeSearchLayers)) routeSearchLayers=[];
  routeSearchLayers.forEach(layer=>{ try{ map.removeLayer(layer); }catch(e){} });
  routeSearchLayers=[];
}
async function drawMultiLineRoute(segments){
  if(!map) return;
  routeFocusActive = true;
  cleanMapForRouteOnly();
  cleanMapForRouteOnly();
  renderRouteSteps(segments);
  clearMultiRouteLayers();
  const pts=[];

  function addMarker(stop, label){
    if(!stop || num(stop.lat)===null || num(stop.lng)===null) return;
    const m=L.marker([num(stop.lat),num(stop.lng)]).addTo(map).bindPopup(label);
    routeSearchLayers.push(m);
    pts.push([num(stop.lat),num(stop.lng)]);
  }

  if(segments.length){
    addRouteMarker(segments[0].from, "Départ", "📍");
    addRouteMarker(segments[segments.length-1].to, "Arrivée", "🏁");
  }

  for(const seg of segments){
    if(seg.type === "bus"){
      const line = lines.find(l=>l.id===seg.lineId);
      const latlngs = seg.stops.map(s=>[num(s.lat),num(s.lng)]).filter(p=>p[0]!==null&&p[1]!==null);
      const layer = L.polyline(latlngs, {color:(line&&line.color)||"#2563eb", weight:7, opacity:.82}).addTo(map);
      routeSearchLayers.push(layer);
      addRouteMarker(seg.from, "Monter", "🚌");
      addRouteMarker(seg.to, "Descendre", "⬇️");
      latlngs.forEach(p=>pts.push(p));
    }else{
      const latlngs = [[num(seg.from.lat),num(seg.from.lng)],[num(seg.to.lat),num(seg.to.lng)]];
      const layer = L.polyline(latlngs, {color:"#111827", weight:5, opacity:.9, dashArray:"4,12"}).addTo(map);
      routeSearchLayers.push(layer);
      latlngs.forEach(p=>pts.push(p));
      addRouteMarker(seg.from, "Descendre", "⬇️");
      addRouteMarker(seg.to, "Reprendre", "⬆️");
    }
  }

  if(pts.length) map.fitBounds(L.latLngBounds(pts), {padding:[40,40]});
}
function findStopsForRouteQuery(q){
  if(typeof searchStopsEverywhere === "function") return searchStopsEverywhere(q);
  const nq = normalizeSearchText(q);
  return stops.filter(s => normalizeSearchText(`${s.name||""} ${getLineName(s.lineId)||""}`).includes(nq));
}
async function searchRouteMultiLines(){
  ensureSearchHelpers();
  const fromTxt = val("fromInput").trim();
  const toTxt = val("toInput").trim();

  if(!fromTxt || !toTxt){
    setText("routeResult","Écris le départ ET la destination.");
    return;
  }

  const fromCandidates = findStopsForRouteQuery(fromTxt).filter(s=>s.active!==false && isLineActive(s.lineId)).slice(0,8);
  const toCandidates = findStopsForRouteQuery(toTxt).filter(s=>s.active!==false && isLineActive(s.lineId)).slice(0,8);

  if(!fromCandidates.length || !toCandidates.length){
    setText("routeResult",`Aucun arrêt trouvé. Départ: ${fromCandidates[0]?.name || "non"} · Destination: ${toCandidates[0]?.name || "non"}`);
    return;
  }

  let best = null;
  for(const start of fromCandidates){
    for(const end of toCandidates){
      if(!start.id || !end.id || start.id === end.id) continue;
      const result = dijkstraRoute(start.id, end.id);
      if(!result) continue;
      const segments = compactSegments(result.path);
      const totals = routeTotals(segments);
      if(totals.walk > MULTI_WALK_LIMIT_METERS) continue;
      const score = result.cost + totals.transfers*5 + (totals.walk/100)*1.5;
      if(!best || score < best.score){
        best = {start,end,result,segments,totals,score};
      }
    }
  }

  if(!best){
    setText("routeResult",`Aucun trajet trouvé. Regarde les suggestions proposées et choisis un arrêt exact.`);
    return;
  }

  await drawMultiLineRoute(best.segments);
  const totalMin = Math.max(1, Math.round(best.totals.min));
  const walkMeters = Math.round(best.totals.walk);
  setText("routeResult",`✅ Meilleur trajet multi-lignes (${totalMin} min, marche ${walkMeters} m, ${best.totals.transfers} correspondance): ${routeSummaryText(best.segments)}`);
}



function cleanMapForRouteOnly(){
  if(!map) return;

  // remove previous focused route layers
  if(Array.isArray(routeSearchLayers)){
    routeSearchLayers.forEach(layer => { try{ map.removeLayer(layer); }catch(e){} });
    routeSearchLayers = [];
  }

  // remove OSM imported layer / GeoJSON layer if present
  try{ if(osmStopsLayer){ map.removeLayer(osmStopsLayer); osmStopsLayer=null; } }catch(e){}
  try{ if(bejaiaGeojsonLayer){ map.removeLayer(bejaiaGeojsonLayer); bejaiaGeojsonLayer=null; } }catch(e){}

  // remove all dynamic leaflet overlays, keep only tile layer
  map.eachLayer(layer => {
    if(layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polyline || layer instanceof L.Polygon || layer instanceof L.GeoJSON){
      try{ map.removeLayer(layer); }catch(e){}
    }
  });
}

function resetRouteSearchView(){
  routeFocusActive = false;
  if(typeof loadOsmStopsGeojson==="function") loadOsmStopsGeojson();
  if(typeof loadBejaiaLinesStopsGeojson==="function") loadBejaiaLinesStopsGeojson();
  if(Array.isArray(routeSearchLayers)){
    routeSearchLayers.forEach(layer=>{try{map.removeLayer(layer)}catch(e){}});
    routeSearchLayers=[];
  }
  renderAll();
  setText("routeResult","Prêt. Écris un arrêt de départ et un arrêt de destination.");if($("routeStepsList"))$("routeStepsList").innerHTML="";
}


function lineBadgeHtml(lineId){
  const line = lines.find(l => l.id === lineId);
  const color = (line && line.color) || "#2563eb";
  const name = getLineName(lineId);
  return `<span class="lineBadge" style="background:${color}">${name}</span>`;
}
function renderRouteSteps(segments){
  const box = $("routeStepsList");
  if(!box) return;
  if(!segments || !segments.length){
    box.innerHTML = "";
    return;
  }

  let html = "";
  segments.forEach((seg, i) => {
    const min = Math.max(1, Math.round(seg.minutes || 0));
    const dist = Math.round(seg.distance || 0);

    if(seg.type === "bus"){
      html += `
        <div class="routeStepCard busStep">
          <div class="stepIcon">🚌</div>
          <div class="stepContent">
            <div class="stepTitle">Monter à <b>${stopLabel(seg.from)}</b></div>
            <div class="stepLine">${lineBadgeHtml(seg.lineId)} <span class="directionBadge">${directionLabel(seg.direction||"aller")}</span></div>
            <div class="stepMeta">Descendre à <b>${stopLabel(seg.to)}</b> · ${min} min</div>
          </div>
        </div>
      `;
    }else{
      html += `
        <div class="routeStepCard walkStep">
          <div class="stepIcon">🚶</div>
          <div class="stepContent">
            <div class="stepTitle">Marcher jusqu’à <b>${stopLabel(seg.to)}</b></div>
            <div class="stepMeta">${dist} m · ${min} min</div>
          </div>
        </div>
      `;
    }
  });

  box.innerHTML = html;
}
function addRouteMarker(stop,label,emoji){
  if(!map || !stop || num(stop.lat)===null || num(stop.lng)===null) return null;
  const icon = L.divIcon({
    className:"routeMarkerLabel",
    html:`<div class="routeMarkerBubble">${emoji} ${label}</div>`,
    iconSize:[150,34],
    iconAnchor:[20,34]
  });
  const marker = L.marker([num(stop.lat),num(stop.lng)],{icon}).addTo(map).bindPopup(label + ": " + stopLabel(stop));
  routeSearchLayers.push(marker);
  return marker;
}


function isAdminRole(){ return userRole === "admin"; }
function isDriverPending(){ return currentUser && userRole === "driver_pending"; }
function isDriverApproved(){ return currentUser && userRole === "driver"; }

async function createUserProfileAfterSignup(user, role){
  if(!user) return;
  if(role === "driver"){
    await db.collection("driverRequests").doc(user.uid).set({
      uid:user.uid,email:user.email||"",name:user.email||"",status:"pending",
      createdAt:now(),updatedAt:now()
    }, {merge:true});
    await db.collection("users").doc(user.uid).set({
      email:user.email||"",role:"driver_pending",active:false,createdAt:now(),updatedAt:now()
    }, {merge:true});
  }else{
    await db.collection("clients").doc(user.uid).set({
      uid:user.uid,email:user.email||"",name:user.email||"",active:true,createdAt:now(),updatedAt:now()
    }, {merge:true});
    await db.collection("users").doc(user.uid).set({
      email:user.email||"",role:"client",active:true,createdAt:now(),updatedAt:now()
    }, {merge:true});
  }
}

async function approveDriver(uid){
  if(!requireAdmin()) return;
  const r = driverRequests.find(x => (x.uid||x.id) === uid) || {};
  try{
    await db.collection("users").doc(uid).set({
      email:r.email||"",role:"driver",active:true,approvedAt:now(),updatedAt:now()
    }, {merge:true});
    await db.collection("drivers").doc(uid).set({
      uid,email:r.email||"",name:r.name||r.email||"",active:true,status:"offline",createdAt:now(),updatedAt:now()
    }, {merge:true});
    await db.collection("driverRequests").doc(uid).set({status:"approved",approvedAt:now(),updatedAt:now()},{merge:true});
    alert("Chauffeur approuvé ✅");
  }catch(e){ alert("Erreur approbation: "+(e.message||e)); }
}

async function rejectDriver(uid){
  if(!requireAdmin()) return;
  if(!confirm("Refuser cette demande chauffeur ?")) return;
  try{
    await db.collection("driverRequests").doc(uid).set({status:"rejected",rejectedAt:now(),updatedAt:now()},{merge:true});
    await db.collection("users").doc(uid).set({role:"driver_rejected",active:false,updatedAt:now()},{merge:true});
    alert("Demande refusée.");
  }catch(e){ alert("Erreur refus: "+(e.message||e)); }
}

function renderPendingDrivers(){
  const box=$("pendingDriversList");
  if(!box) return;
  const pending=(driverRequests||[]).filter(r=>r.status==="pending");
  box.innerHTML = pending.length ? pending.map(r=>`
    <div class="item">
      <strong>🚕 ${r.name||r.email||r.id}</strong>
      <span class="muted">${r.email||""} · En attente confirmation admin</span>
      <div class="actions">
        <button class="activateBtn" data-approve-driver="${r.uid||r.id}" type="button">Approuver</button>
        <button class="deleteBtn" data-reject-driver="${r.uid||r.id}" type="button">Refuser</button>
      </div>
    </div>
  `).join("") : '<div class="muted">Aucune demande chauffeur.</div>';
  document.querySelectorAll("[data-approve-driver]").forEach(b=>b.onclick=()=>approveDriver(b.dataset.approveDriver));
  document.querySelectorAll("[data-reject-driver]").forEach(b=>b.onclick=()=>rejectDriver(b.dataset.rejectDriver));
}

function applyRoleVisibility(){
  const p=$("driverPendingCard");
  if(p) p.classList.toggle("hidden", !isDriverPending());
  const d=$("driverPage");
  if(d) d.classList.toggle("driverBlocked", isDriverPending());
}


let guestMode = false;

function showAuthGate(show){
  const g = $("authGate");
  if(!g) return;
  g.classList.toggle("hidden", !show);
}
function showAuthTab(tab){
  const login = tab === "login";
  if($("authLoginBox")) $("authLoginBox").classList.toggle("hidden", !login);
  if($("authSignupBox")) $("authSignupBox").classList.toggle("hidden", login);
  if($("authTabLogin")) $("authTabLogin").classList.toggle("active", login);
  if($("authTabSignup")) $("authTabSignup").classList.toggle("active", !login);
}
function roleHomePage(){
  if(userRole === "admin") return "admin";
  if(userRole === "driver" || userRole === "driver_pending") return "driver";
  return "client";
}
function openRoleHome(){
  const page = roleHomePage();
  try{
    document.querySelectorAll(".bottomNav button,[data-page]").forEach(b=>b.classList.remove("active"));
  }catch(e){}
  if(typeof switchPage === "function") switchPage(page);
  else {
    ["clientPage","driverPage","adminPage"].forEach(id=>{ if($(id)) $(id).classList.add("hidden"); });
    const target = page==="admin" ? "adminPage" : page==="driver" ? "driverPage" : "clientPage";
    if($(target)) $(target).classList.remove("hidden");
  }
}
async function gateLogin(){
  try{
    setText("gateAuthStatus","Connexion...");
    const cred = await auth.signInWithEmailAndPassword(val("gateEmailLogin").trim(), val("gatePasswordLogin"));
    currentUser = cred.user;
    await loadRole();
    showAuthGate(false);
    openRoleHome();
    setText("gateAuthStatus","");
  }catch(e){
    setText("gateAuthStatus","Erreur connexion: "+(e.message||e));
    alert("Erreur connexion: "+(e.message||e));
  }
}
async function gateSignup(){
  try{
    setText("gateAuthStatus","Création du compte...");
    const role = val("gateSignupRole") || "client";
    const cred = await auth.createUserWithEmailAndPassword(val("gateEmailSignup").trim(), val("gatePasswordSignup"));
    currentUser = cred.user;
    if(typeof createUserProfileAfterSignup === "function"){
      await createUserProfileAfterSignup(cred.user, role);
    }else{
      await db.collection("users").doc(cred.user.uid).set({
        email:cred.user.email || "",
        role: role === "driver" ? "driver_pending" : "client",
        active: role !== "driver",
        createdAt:now(),
        updatedAt:now()
      }, {merge:true});
      if(role === "driver"){
        await db.collection("driverRequests").doc(cred.user.uid).set({
          uid:cred.user.uid,email:cred.user.email||"",status:"pending",createdAt:now(),updatedAt:now()
        }, {merge:true});
      }
    }
    await loadRole();
    showAuthGate(false);
    openRoleHome();
    setText("gateAuthStatus", role==="driver" ? "Compte chauffeur en attente admin." : "Compte client créé.");
    if(role==="driver") alert("Compte chauffeur créé. En attente d’approbation admin.");
  }catch(e){
    setText("gateAuthStatus","Erreur inscription: "+(e.message||e));
    alert("Erreur inscription: "+(e.message||e));
  }
}
function setupAuthGateEvents(){
  if($("authTabLogin")) $("authTabLogin").onclick=()=>showAuthTab("login");
  if($("authTabSignup")) $("authTabSignup").onclick=()=>showAuthTab("signup");
  if($("gateLoginBtn")) $("gateLoginBtn").onclick=gateLogin;
  if($("gateSignupBtn")) $("gateSignupBtn").onclick=gateSignup;
  if($("continueGuestBtn")) $("continueGuestBtn").onclick=()=>{guestMode=true;showAuthGate(false);if(typeof switchPage==="function")switchPage("client");};
}
function refreshAuthGate(){
  if(currentUser || guestMode) showAuthGate(false);
  else showAuthGate(true);
}


// =========================
// SUGGESTIONS ARRÊTS CLIENT
// =========================
function normalizeSuggestText(txt){
  return (txt || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}
function suggestScore(query, text){
  const q = normalizeSuggestText(query);
  const t = normalizeSuggestText(text);
  if(!q || !t) return 0;
  if(t === q) return 1000;
  if(t.startsWith(q)) return 800;
  if(t.includes(q)) return 650;
  const words = q.split(" ").filter(Boolean);
  let score = 0;
  words.forEach(w => {
    if(t.includes(w)) score += 120;
    else {
      // simple fuzzy: letters in order
      let pos = 0, ok = true;
      for(const ch of w){
        pos = t.indexOf(ch, pos);
        if(pos === -1){ ok = false; break; }
        pos++;
      }
      if(ok) score += 35;
    }
  });
  return score;
}
function activeClientStopsForSuggest(){
  let list = (typeof activeStopsOnly === "function") ? activeStopsOnly() : stops.filter(s=>s.active!==false);
  const city = val("clientCity") || "";
  const lineId = val("clientLineSelect") || "all";
  if(city && typeof normalizeCity === "function"){
    list = list.filter(s => !s.city || normalizeCity(s.city) === normalizeCity(city));
  }
  if(lineId && lineId !== "all"){
    list = list.filter(s => s.lineId === lineId);
  }
  return list;
}
function buildStopSuggestions(query, limit=8){
  const list = activeClientStopsForSuggest();
  return list
    .map(s => {
      const label = `${s.name || ""} · ${getLineName(s.lineId)}`;
      const score = suggestScore(query, label) + suggestScore(query, s.name || "") * 1.5;
      return {stop:s,label,score};
    })
    .filter(x => x.score > 0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,limit);
}
function renderInputSuggestions(inputId, datalistId){
  const input = $(inputId);
  const datalist = $(datalistId);
  if(!input || !datalist) return;
  const suggestions = buildStopSuggestions(input.value, 10);
  datalist.innerHTML = suggestions.map(x => `<option value="${x.stop.name || ""}">${x.label}</option>`).join("");
}
function renderRouteSuggestionBox(){
  const box = $("routeSuggestionBox");
  if(!box) return;
  const fromQ = val("fromInput");
  const toQ = val("toInput");
  const from = buildStopSuggestions(fromQ, 4);
  const to = buildStopSuggestions(toQ, 4);

  if(!fromQ && !toQ){
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  const block = (title, items, targetId) => `
    <div class="suggestGroup">
      <div class="suggestTitle">${title}</div>
      ${items.length ? items.map(x => `
        <button type="button" class="suggestBtn" data-fill="${targetId}" data-value="${x.stop.name || ""}">
          📍 ${x.stop.name || "Arrêt"} <small>${getLineName(x.stop.lineId)}</small>
        </button>
      `).join("") : '<div class="suggestEmpty">Aucune suggestion</div>'}
    </div>
  `;

  box.innerHTML = block("Suggestions départ", from, "fromInput") + block("Suggestions destination", to, "toInput");
  box.classList.remove("hidden");

  box.querySelectorAll("[data-fill]").forEach(btn=>{
    btn.onclick=()=>{
      $(btn.dataset.fill).value = btn.dataset.value;
      renderInputSuggestions("fromInput","fromSuggestions");
      renderInputSuggestions("toInput","toSuggestions");
      renderRouteSuggestionBoxPro();
    };
  });
}

// =========================
// SUGGESTIONS PRO + RÉCENTS
// =========================
function uniqueSuggestions(items){
  const seen = new Set();
  const out = [];
  items.forEach(x => {
    const key = normalizeSuggestText((x.stop.name || "") + "|" + (x.stop.lineId || ""));
    if(seen.has(key)) return;
    seen.add(key);
    out.push(x);
  });
  return out;
}
function buildStopSuggestionsPro(query, limit=6){
  return uniqueSuggestions(buildStopSuggestions(query, 20)).slice(0, limit);
}
function fillSuggestion(targetId, value){
  const input = $(targetId);
  if(!input) return;
  input.value = value || "";
  if(targetId === "fromInput" && $("toInput")) $("toInput").focus();
  if($("routeSuggestionBox")){
    $("routeSuggestionBox").classList.add("hidden");
    $("routeSuggestionBox").innerHTML = "";
  }
  renderInputSuggestions("fromInput","fromSuggestions");
  renderInputSuggestions("toInput","toSuggestions");
}
function recentTrips(){
  try{return JSON.parse(localStorage.getItem("transportRecentTrips") || "[]");}
  catch(e){return [];}
}
function saveRecentTrip(from,to){
  if(!from || !to) return;
  let arr = recentTrips().filter(x => !(x.from === from && x.to === to));
  arr.unshift({from,to,ts:Date.now()});
  arr = arr.slice(0,5);
  localStorage.setItem("transportRecentTrips", JSON.stringify(arr));
  renderRecentTrips();
}
function renderRecentTrips(){
  const box = $("recentTripsBox");
  if(!box) return;
  const arr = recentTrips();
  if(!arr.length){
    box.innerHTML = `
      <div class="favRow">
        <button type="button" class="favBtn" data-tofav="Université">🎓 Université</button>
        <button type="button" class="favBtn" data-tofav="Gare routière">🚌 Gare</button>
        <button type="button" class="favBtn" data-tofav="Sidi Aïch">📍 Sidi Aïch</button>
      </div>`;
  }else{
    box.innerHTML = '<div class="recentTitle">Derniers trajets</div>' + arr.map(x=>`
      <button type="button" class="recentTripBtn" data-from="${x.from}" data-to="${x.to}">
        🕘 ${x.from} → ${x.to}
      </button>
    `).join("");
  }
  box.querySelectorAll("[data-from]").forEach(b=>{
    b.onclick=()=>{
      $("fromInput").value=b.dataset.from;
      $("toInput").value=b.dataset.to;
      renderRouteSuggestionBoxPro();
    };
  });
  box.querySelectorAll("[data-tofav]").forEach(b=>{
    b.onclick=()=>{
      $("toInput").value=b.dataset.tofav;
      renderRouteSuggestionBoxPro();
      $("toInput").focus();
    };
  });
}
function renderRouteSuggestionBoxPro(){ if(activeSuggestInputId){ showGoogleSuggestions(activeSuggestInputId); return; }
  const box = $("routeSuggestionBox");
  if(!box) return;
  const fromQ = val("fromInput");
  const toQ = val("toInput");
  const from = buildStopSuggestionsPro(fromQ, 5);
  const to = buildStopSuggestionsPro(toQ, 5);

  if(!fromQ && !toQ){
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  function block(title, items, targetId){
    return `
      <div class="suggestGroup">
        <div class="suggestTitle">${title}</div>
        ${items.length ? items.map(x => `
          <button type="button" class="suggestBtn" data-fill="${targetId}" data-value="${(x.stop.name || "").replaceAll('"','&quot;')}">
            <span>📍 ${x.stop.name || "Arrêt"}</span>
            <small>${getLineName(x.stop.lineId)}</small>
          </button>
        `).join("") : '<div class="suggestEmpty">Aucune suggestion proche</div>'}
      </div>
    `;
  }

  box.innerHTML = block("Départ proposé", from, "fromInput") + block("Destination proposée", to, "toInput");
  box.classList.remove("hidden");

  box.querySelectorAll("[data-fill]").forEach(btn=>{
    btn.onclick=()=>fillSuggestion(btn.dataset.fill, btn.dataset.value);
  });
}

function setupRouteSuggestions(){renderRecentTrips();
  ["fromInput","toInput"].forEach(id=>{
    const input=$(id);
    if(!input) return;
    input.addEventListener("input", ()=>{
      renderInputSuggestions("fromInput","fromSuggestions");
      renderInputSuggestions("toInput","toSuggestions");
      renderRouteSuggestionBoxPro();
    });
    input.addEventListener("focus", ()=>{
      renderInputSuggestions("fromInput","fromSuggestions");
      renderInputSuggestions("toInput","toSuggestions");
      renderRouteSuggestionBoxPro();
    });
  });
}


// =========================
// GOOGLE MAPS STYLE SUGGESTIONS
// =========================
let activeSuggestInputId = null;

function showGoogleSuggestions(inputId){
  activeSuggestInputId = inputId;
  const box = $("googleSuggestBox");
  if(!box) return;

  const query = val(inputId);
  const suggestions = (typeof buildStopSuggestionsPro === "function")
    ? buildStopSuggestionsPro(query, 7)
    : buildStopSuggestions(query, 7);

  if(!query || !suggestions.length){
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  const title = inputId === "fromInput" ? "Choisir le départ" : "Choisir la destination";

  box.innerHTML = `
    <div class="gSuggestHeader">
      <span>${title}</span>
      <button type="button" id="closeGoogleSuggestBtn">✕</button>
    </div>
    ${suggestions.map(x => `
      <button type="button" class="gSuggestItem" data-value="${(x.stop.name || "").replaceAll('"','&quot;')}">
        <span class="gPin">📍</span>
        <span class="gText">
          <b>${x.stop.name || "Arrêt"}</b>
          <small>${getLineName(x.stop.lineId)}</small>
        </span>
      </button>
    `).join("")}
  `;

  box.classList.remove("hidden");

  const close = $("closeGoogleSuggestBtn");
  if(close) close.onclick = () => {
    box.classList.add("hidden");
    box.innerHTML = "";
  };

  box.querySelectorAll(".gSuggestItem").forEach(btn => {
    btn.onclick = () => {
      const input = $(activeSuggestInputId);
      if(input) input.value = btn.dataset.value || "";
      box.classList.add("hidden");
      box.innerHTML = "";
      if(activeSuggestInputId === "fromInput" && $("toInput")){
        setTimeout(() => $("toInput").focus(), 80);
      }
    };
  });
}

function setupGoogleSuggestions(){
  ["fromInput","toInput"].forEach(id => {
    const input = $(id);
    if(!input) return;

    input.setAttribute("autocomplete", "off");

    input.addEventListener("input", () => showGoogleSuggestions(id));
    input.addEventListener("focus", () => showGoogleSuggestions(id));
  });

  document.addEventListener("click", (e) => {
    const box = $("googleSuggestBox");
    if(!box || box.classList.contains("hidden")) return;
    if(e.target.closest("#googleSuggestBox")) return;
    if(e.target.id === "fromInput" || e.target.id === "toInput") return;
    box.classList.add("hidden");
  });
}

function setupEvents(){setupGoogleSuggestions();if($('clearFromBtn'))$('clearFromBtn').onclick=()=>{if($('fromInput'))$('fromInput').value='';renderRouteSuggestionBoxPro();};if($('clearToBtn'))$('clearToBtn').onclick=()=>{if($('toInput'))$('toInput').value='';renderRouteSuggestionBoxPro();};setupRouteSuggestions();if($('etaRefreshBtn')) $('etaRefreshBtn').onclick=renderEta;if($('etaStopSelect')) $('etaStopSelect').onchange=renderEta;setupAuthGateEvents();$("openLoginBtn").onclick=()=>{showAuthGate(true);showAuthTab("login");};$("closeLoginBtn").onclick=()=>$("loginModal").classList.add("hidden");$("loginBtn").onclick=async()=>{try{setText("authStatus","Connexion...");const cred=await auth.signInWithEmailAndPassword(val("emailInput").trim(),val("passwordInput"));currentUser=cred.user;await loadRole();$("loginModal").classList.add("hidden")}catch(e){authError(e)}};$("signupBtn").onclick=async()=>{try{const cred=await auth.createUserWithEmailAndPassword(val("emailInput").trim(),val("passwordInput"));await createUserProfileAfterSignup(cred.user,val("signupRoleSelect")||"client");currentUser=cred.user;await loadRole()}catch(e){authError(e)}};$("logoutBtn").onclick=async()=>{await goOffline().catch(()=>{});await auth.signOut();guestMode=false;showAuthGate(true);currentUser=null;currentRole="guest";setAuthUi()};document.querySelectorAll(".navBtn").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".navBtn").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.page).classList.add("active");setTimeout(()=>map&&map.invalidateSize(),250)});document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".adminPanel").forEach(p=>p.classList.remove("active"));btn.classList.add("active");$(btn.dataset.panel).classList.add("active")});
if($("adminStopsLineFilter")) $("adminStopsLineFilter").onchange=renderLists;
if($("adminStopsSearch")) $("adminStopsSearch").oninput=renderLists;
if($("loadExampleImportBtn")) $("loadExampleImportBtn").onclick=loadExampleImport;if($("importLinesBtn")) $("importLinesBtn").onclick=importAlgeriaLines;if($("showOsmStopsToggle")) $("showOsmStopsToggle").onchange=renderAll;if($("importOsmStopsBtn")) $("importOsmStopsBtn").onclick=importOsmStopsToFirebase;if($("showBejaiaGeojsonToggle")) $("showBejaiaGeojsonToggle").onchange=renderAll;if($("autoImportBejaiaBtn")) $("autoImportBejaiaBtn").onclick=importBejaiaAutoLinesAndStops;if($("deleteAllLinesStopsBtn")) $("deleteAllLinesStopsBtn").onclick=deleteAllLinesAndStops;if($("importBejaiaStopsBtn")) $("importBejaiaStopsBtn").onclick=importBejaiaStopsToFirebase;if($("createBejaiaLinesBtn")) $("createBejaiaLinesBtn").onclick=createFirebaseLinesFromBejaiaGeojson;$("addLineBtn").onclick=saveLine;$("addStopBtn").onclick=saveStop;$("addVehicleBtn").onclick=saveVehicle;$("addDriverBtn").onclick=saveDriver;$("goOnlineBtn").onclick=goOnline;$("goOfflineBtn").onclick=goOffline;$("driverVehicleSelect").onchange=renderDriverWorkStatus;if($("clearRouteBtn")) $("clearRouteBtn").onclick=resetRouteSearchView;$("clientGpsBtn").onclick=clientGps;$("clientLineSelect").onchange=renderAll;$("clientCity").onchange=renderAll;if($("startWalkingTrackBtn")) $("startWalkingTrackBtn").onclick=startWalkingTrack;if($("stopWalkingTrackBtn")) $("stopWalkingTrackBtn").onclick=stopWalkingTrack;$("searchRouteBtn").onclick=()=>{saveRecentTrip(val("fromInput"),val("toInput"));return searchRouteMultiLines().catch(e=>{console.error(e);setText("routeResult","Erreur trajet multi-lignes: "+(e.message||e));});};$("useMyLocationStopBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();$("stopLat").value=lat.toFixed(6);$("stopLng").value=lng.toFixed(6)}catch(e){alert("GPS impossible.")}};$("pickStopOnMapBtn").onclick=openStopPicker;$("pickerCloseBtn").onclick=()=>$("stopPickerModal").classList.add("hidden");$("pickerUseGpsBtn").onclick=async()=>{try{const[lat,lng]=await getPosition();initStopPicker();stopPickerMap.setView([lat,lng],16);setPicked(lat,lng)}catch(e){alert("GPS impossible.")}};$("pickerConfirmBtn").onclick=()=>{if(pickedLat==null)return alert("Choisis une position.");$("stopLat").value=pickedLat.toFixed(6);$("stopLng").value=pickedLng.toFixed(6);$("stopPickerModal").classList.add("hidden")}}
function init(){setFirebaseStatus(true);initMap();setupEvents();auth.onAuthStateChanged(async user=>{currentUser=user;await loadRole();refreshAuthGate();if(user)openRoleHome();bindRealtime()});setInterval(renderAll,30000)}
window.addEventListener("load",init);
})();


// Firestore nested array fix applied
function parseStoredRouteGeometry(value){
  try{
    if(typeof value === "string") return JSON.parse(value);
    return value || null;
  }catch(e){
    return null;
  }
}
