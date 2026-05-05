import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, setDoc, deleteDoc, getDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const $ = id => document.getElementById(id);
let app, auth, db, currentUser=null, currentRole='guest';
let map, stopPickerMap, stopPickerMarker, pickedLat=null, pickedLng=null;
let lines=[], stops=[], vehicles=[];
let unsub=[], driverWatchId=null, lastGpsWrite=0, clientLocationMarker=null, clientCentered=false;

function setText(id,txt){const e=$(id); if(e)e.textContent=txt;}
function setFirebaseStatus(ok,text){const e=$('firebaseStatus'); e.textContent=text; e.className='badge '+(ok?'green':'blue');}
function setAuthUi(){
  const btn=$('openLoginBtn');
  if(currentUser){btn.textContent='Connecté'; btn.className='badge green'; setText('authStatus',`Connecté: ${currentUser.email} · rôle: ${currentRole}`);}
  else{btn.textContent='Connexion'; btn.className='badge light'; setText('authStatus','Non connecté');}
}
function authError(e){
  console.error(e);
  let msg=e?.message||'Erreur connexion';
  if(e?.code==='auth/invalid-credential') msg='Email ou mot de passe incorrect.';
  if(e?.code==='auth/operation-not-allowed') msg='Active Email/Password dans Firebase.';
  if(e?.code==='auth/unauthorized-domain') msg='Ajoute le domaine GitHub Pages dans Firebase Authentication.';
  alert(msg); setText('authStatus',msg);
}
async function loadRole(){
  currentRole='guest';
  if(!currentUser||!db){setAuthUi(); return;}
  const uid=currentUser.uid, email=(currentUser.email||'').toLowerCase();
  if(email==='allaouaboucheneb04@gmail.com'){currentRole='admin'; setAuthUi(); return;}
  try{
    const a=await getDoc(doc(db,'admins',uid));
    if(a.exists()&&(a.data().active===true||a.data().role==='admin')){currentRole='admin'; setAuthUi(); return;}
    const u=await getDoc(doc(db,'users',uid));
    if(u.exists()){currentRole=u.data().role||'driver'; setAuthUi(); return;}
    await setDoc(doc(db,'users',uid),{email:currentUser.email,role:'driver',active:true,createdAt:serverTimestamp()},{merge:true});
    currentRole='driver';
  }catch(e){console.error(e); currentRole='driver';}
  setAuthUi();
}
function requireAdmin(){if(!currentUser){alert('Connecte-toi d’abord.'); return false;} if(currentRole!=='admin'){alert('Compte admin requis.'); return false;} return true;}

function initFirebase(){
  app=initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app); setFirebaseStatus(true,'Firebase connecté');
  onAuthStateChanged(auth,async user=>{currentUser=user; await loadRole(); bindRealtime(); renderAll();});
}
function bindRealtime(){
  unsub.forEach(f=>f&&f()); unsub=[];
  if(!db)return;
  unsub.push(onSnapshot(collection(db,'lines'),s=>{lines=s.docs.map(d=>({id:d.id,...d.data()})); renderAll();}));
  unsub.push(onSnapshot(collection(db,'stops'),s=>{stops=s.docs.map(d=>({id:d.id,...d.data()})); renderAll();}));
  unsub.push(onSnapshot(collection(db,'vehicles'),s=>{vehicles=s.docs.map(d=>({id:d.id,...d.data()})); renderAll();}));
}
function initMap(){
  if(map)return;
  map=L.map('map').setView([36.7525,5.0843],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
}
const num=v=>{const x=Number(v); return Number.isFinite(x)?x:null;};
const lineName=id=>lines.find(l=>l.id===id)?.name||id||'';
function drawMap(){
  initMap();
  map.eachLayer(layer=>{if(layer instanceof L.Marker||layer instanceof L.CircleMarker||layer instanceof L.Polyline)map.removeLayer(layer);});
  const selected=$('clientLineSelect')?.value||'all';
  const visibleStops=stops.filter(s=>{
    const lat=num(s.lat??s.latitude), lng=num(s.lng??s.longitude);
    return lat!==null&&lng!==null&&(selected==='all'||s.lineId===selected||s.line===selected);
  });
  visibleStops.forEach(s=>{
    const lat=num(s.lat??s.latitude), lng=num(s.lng??s.longitude);
    L.circleMarker([lat,lng],{radius:8,weight:3,fillOpacity:.9}).addTo(map).bindPopup(`🚏 ${s.name||'Arrêt'}<br>${lineName(s.lineId)}`);
  });
  vehicles.forEach(v=>{
    const lat=num(v.lat), lng=num(v.lng); if(lat===null||lng===null)return;
    L.marker([lat,lng]).addTo(map).bindPopup(`🚌 ${v.name||'Véhicule'}<br>${lineName(v.lineId)}<br>${v.status||''}`);
  });
  if(clientLocationMarker) clientLocationMarker.addTo(map);
  if(!clientCentered){
    const pts=[...visibleStops.map(s=>[num(s.lat??s.latitude),num(s.lng??s.longitude)]),...vehicles.map(v=>[num(v.lat),num(v.lng)]).filter(p=>p[0]!==null&&p[1]!==null)];
    if(pts.length) map.fitBounds(pts,{padding:[30,30],maxZoom:14});
  }
}
function renderSelects(){
  const opts=['<option value="all">Toutes les lignes</option>',...lines.map(l=>`<option value="${l.id}">${l.name||l.id}</option>`)].join('');
  $('clientLineSelect').innerHTML=opts;
  const adminOpts=lines.map(l=>`<option value="${l.id}">${l.name||l.id}</option>`).join('');
  $('stopLineSelect').innerHTML=adminOpts; $('vehicleLineSelect').innerHTML=adminOpts;
  $('driverVehicleSelect').innerHTML=vehicles.map(v=>`<option value="${v.id}">${v.name||v.id}</option>`).join('');
}
function renderLists(){
  $('stopsList').innerHTML=stops.length?stops.map(s=>`<div class="item"><strong>🚏 ${s.name||'Arrêt'}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat??s.latitude}, ${s.lng??s.longitude}</span></div>`).join(''):'<div class="muted">Aucun arrêt.</div>';
  $('linesAdminList').innerHTML=lines.length?lines.map(l=>`<div class="item"><strong>${l.name||l.id}</strong><span class="muted">${l.type||'bus'}</span><button class="deleteBtn" data-del-line="${l.id}">Supprimer</button></div>`).join(''):'<div class="muted">Aucune ligne.</div>';
  $('stopsAdminList').innerHTML=stops.length?stops.map(s=>`<div class="item"><strong>${s.name||s.id}</strong><span class="muted">${lineName(s.lineId)} · ${s.lat??s.latitude}, ${s.lng??s.longitude}</span><button class="deleteBtn" data-del-stop="${s.id}">Supprimer</button></div>`).join(''):'<div class="muted">Aucun arrêt.</div>';
  $('vehiclesAdminList').innerHTML=vehicles.length?vehicles.map(v=>`<div class="item"><strong>${v.name||v.id}</strong><span class="muted">${lineName(v.lineId)} · chauffeur: ${v.driverId||''}</span><button class="deleteBtn" data-del-veh="${v.id}">Supprimer</button></div>`).join(''):'<div class="muted">Aucun véhicule.</div>';
  document.querySelectorAll('[data-del-line]').forEach(b=>b.onclick=()=>requireAdmin()&&deleteDoc(doc(db,'lines',b.dataset.delLine)));
  document.querySelectorAll('[data-del-stop]').forEach(b=>b.onclick=()=>requireAdmin()&&deleteDoc(doc(db,'stops',b.dataset.delStop)));
  document.querySelectorAll('[data-del-veh]').forEach(b=>b.onclick=()=>requireAdmin()&&deleteDoc(doc(db,'vehicles',b.dataset.delVeh)));
}
function renderAll(){renderSelects(); renderLists(); if($('map'))drawMap();}
function centerClient(){
  if(!navigator.geolocation){alert('GPS non disponible.');return;}
  setText('routeResult','Recherche de ta position...');
  navigator.geolocation.getCurrentPosition(p=>{
    const lat=p.coords.latitude,lng=p.coords.longitude; clientCentered=true; map.setView([lat,lng],16);
    if(clientLocationMarker)clientLocationMarker.setLatLng([lat,lng]); else clientLocationMarker=L.circleMarker([lat,lng],{radius:10,weight:3,fillOpacity:.85}).addTo(map);
    clientLocationMarker.bindPopup('📍 Ma position').openPopup(); setText('routeResult','Carte centrée sur ta position.');
  },e=>{
    let msg='GPS impossible.'; if(e.code===1)msg='GPS refusé. Autorise la position pour Safari.'; if(e.code===2)msg='Position indisponible. Active Wi‑Fi + données cellulaires.'; if(e.code===3)msg='GPS trop long. Essaie dehors ou près d’une fenêtre.';
    setText('routeResult',msg); alert(msg);
  },{enableHighAccuracy:false,timeout:20000,maximumAge:60000});
}
function getStopLocation(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res([p.coords.latitude,p.coords.longitude]),rej,{enableHighAccuracy:false,timeout:20000,maximumAge:60000}):rej(new Error('GPS non disponible')));}
function initStopPicker(){
  if(stopPickerMap)return;
  stopPickerMap=L.map('stopPickerMap').setView([36.7525,5.0843],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(stopPickerMap);
  stopPickerMap.on('click',e=>setPicked(e.latlng.lat,e.latlng.lng));
}
function setPicked(lat,lng){
  pickedLat=lat;pickedLng=lng;
  if(stopPickerMarker)stopPickerMarker.setLatLng([lat,lng]); else{stopPickerMarker=L.marker([lat,lng],{draggable:true}).addTo(stopPickerMap);stopPickerMarker.on('dragend',()=>{const p=stopPickerMarker.getLatLng();setPicked(p.lat,p.lng);});}
  setText('pickedCoords',`Latitude: ${lat.toFixed(6)} · Longitude: ${lng.toFixed(6)}`);
}
function openStopPicker(){
  $('stopPickerModal').classList.remove('hidden');
  setTimeout(()=>{initStopPicker();const lat=num($('stopLat').value)||36.7525,lng=num($('stopLng').value)||5.0843;stopPickerMap.invalidateSize();stopPickerMap.setView([lat,lng],14);setPicked(lat,lng);},150);
}
function setupEvents(){
  $('openLoginBtn').onclick=()=>$('loginModal').classList.remove('hidden');
  $('closeLoginBtn').onclick=()=>$('loginModal').classList.add('hidden');
  $('loginBtn').onclick=async()=>{try{const c=await signInWithEmailAndPassword(auth,$('emailInput').value.trim(),$('passwordInput').value);currentUser=c.user;await loadRole();$('loginModal').classList.add('hidden');alert('Connexion réussie ✅');}catch(e){authError(e);}};
  $('signupBtn').onclick=async()=>{try{const c=await createUserWithEmailAndPassword(auth,$('emailInput').value.trim(),$('passwordInput').value);currentUser=c.user;await loadRole();alert('Compte créé ✅');}catch(e){authError(e);}};
  $('logoutBtn').onclick=async()=>{await signOut(auth);currentUser=null;currentRole='guest';setAuthUi();};
  document.querySelectorAll('.navBtn').forEach(b=>b.onclick=()=>{document.querySelectorAll('.navBtn').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));b.classList.add('active');$(b.dataset.page).classList.add('active');setTimeout(()=>map&&map.invalidateSize(),250);});
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.adminPanel').forEach(p=>p.classList.remove('active'));b.classList.add('active');$('panel'+b.dataset.tab[0].toUpperCase()+b.dataset.tab.slice(1)).classList.add('active');});
  $('clientGpsBtn').onclick=centerClient;
  $('clientLineSelect').onchange=()=>{clientCentered=false;renderAll();};
  $('searchRouteBtn').onclick=()=>{const q=($('fromInput').value+' '+$('toInput').value).trim().toLowerCase();const h=stops.filter(s=>(s.name||'').toLowerCase().includes(q));setText('routeResult',h.length?`${h.length} arrêt(s) trouvé(s).`:'Aucun trajet automatique pour le moment.');};
  $('addLineBtn').onclick=async()=>{if(!requireAdmin())return;await addDoc(collection(db,'lines'),{name:$('lineName').value.trim(),type:$('lineType').value,color:$('lineColor').value,active:true,createdAt:serverTimestamp()});$('lineName').value='';};
  $('useMyLocationStopBtn').onclick=async()=>{try{const [lat,lng]=await getStopLocation();$('stopLat').value=lat.toFixed(6);$('stopLng').value=lng.toFixed(6);}catch(e){alert('GPS impossible.');}};
  $('pickStopOnMapBtn').onclick=openStopPicker;$('pickerCloseBtn').onclick=()=>$('stopPickerModal').classList.add('hidden');
  $('pickerUseGpsBtn').onclick=async()=>{try{const [lat,lng]=await getStopLocation();initStopPicker();stopPickerMap.setView([lat,lng],16);setPicked(lat,lng);}catch(e){alert('GPS impossible.');}};
  $('pickerConfirmBtn').onclick=()=>{if(pickedLat==null)return alert('Choisis une position.');$('stopLat').value=pickedLat.toFixed(6);$('stopLng').value=pickedLng.toFixed(6);$('stopPickerModal').classList.add('hidden');};
  $('addStopBtn').onclick=async()=>{if(!requireAdmin())return;const lat=num($('stopLat').value),lng=num($('stopLng').value);if(lat===null||lng===null)return alert('Latitude/longitude invalide.');await addDoc(collection(db,'stops'),{lineId:$('stopLineSelect').value,name:$('stopName').value.trim(),lat,lng,active:true,createdAt:serverTimestamp()});$('stopName').value='';$('stopLat').value='';$('stopLng').value='';};
  $('addVehicleBtn').onclick=async()=>{if(!requireAdmin())return;await addDoc(collection(db,'vehicles'),{name:$('vehicleName').value.trim(),lineId:$('vehicleLineSelect').value,driverId:$('vehicleDriverId').value.trim(),status:'active',lat:36.7525,lng:5.0843,updatedAt:serverTimestamp()});$('vehicleName').value='';$('vehicleDriverId').value='';};
  $('startDriverGpsBtn').onclick=()=>{if(!currentUser)return alert('Connecte-toi.');const id=$('driverVehicleSelect').value;if(!id)return alert('Choisis un véhicule.');if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);driverWatchId=navigator.geolocation.watchPosition(async p=>{const now=Date.now();if(now-lastGpsWrite<15000)return;lastGpsWrite=now;await setDoc(doc(db,'vehicles',id),{lat:p.coords.latitude,lng:p.coords.longitude,driverId:currentUser.uid,status:'active',updatedAt:serverTimestamp()},{merge:true});setText('driverStatus','GPS envoyé: '+new Date().toLocaleTimeString());},()=>alert('GPS chauffeur impossible'),{enableHighAccuracy:false,timeout:20000,maximumAge:10000});setText('driverStatus','GPS démarré.');};
  $('stopDriverGpsBtn').onclick=()=>{if(driverWatchId)navigator.geolocation.clearWatch(driverWatchId);driverWatchId=null;setText('driverStatus','GPS arrêté.');};
}
window.addEventListener('load',()=>{setupEvents();initFirebase();initMap();});
