import { firebaseConfig } from './firebase-config.js';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, where, serverTimestamp, getDoc, getDocs, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const BEJAIA_CENTER = [36.7509, 5.0567];
let app, auth, db, currentUser=null, currentRole='guest', firebaseReady=false;
let map, markers=[], unsubscribers=[], gpsWatchId=null, lastGpsWrite=0, clientMapCenteredByGps=false;
let state={lines:[],stops:[],vehicles:[]};
const $ = id => document.getElementById(id);
const isConfigured = () => window.firebaseConfig && !String(window.firebaseConfig.apiKey||'').includes('REMPLACE');

function initFirebase(){
  if(!isConfigured()){ setSync('Config Firebase manquante', false); renderAll(); return; }
  app = initializeApp(firebaseConfig); auth=getAuth(app); db=getFirestore(app); firebaseReady=true; setSync('Firebase connecté', true);
  onAuthStateChanged(auth, async user=>{
    currentUser = user || null;
    if(currentUser){
      await loadRole();
    }else{
      currentRole = 'guest';
      setAuthUiState(null);
    }
    bindRealtime();
    renderAll();
  });
}
async function loadRole(){
  currentRole = 'guest';
  if(!currentUser || !db) return;

  const uid = currentUser.uid;
  const email = (currentUser.email || '').toLowerCase();

  try{
    // Sécurité temporaire pour ton compte principal
    if(email === 'allaouaboucheneb04@gmail.com'){
      currentRole = 'admin';
      $('authStatus').textContent = `Connecté: ${currentUser.email} · UID: ${uid} · rôle: admin`;
      setAuthUiState(currentUser);
      return;
    }

    // Méthode 1: admins / UID
    const adminSnap = await getDoc(doc(db,'admins',uid));
    if(adminSnap.exists()){
      const d = adminSnap.data();
      if(d.active === true || d.role === 'admin'){
        currentRole = 'admin';
        $('authStatus').textContent = `Connecté: ${currentUser.email} · UID: ${uid} · rôle: admin`;
        setAuthUiState(currentUser);
        return;
      }
    }

    // Méthode 2: users / UID
    const userSnap = await getDoc(doc(db,'users',uid));
    if(userSnap.exists()){
      const d = userSnap.data();
      currentRole = d.role || 'driver';
      $('authStatus').textContent = `Connecté: ${currentUser.email} · UID: ${uid} · rôle: ${currentRole}`;
      setAuthUiState(currentUser);
      return;
    }

    // Création chauffeur par défaut
    await setDoc(doc(db,'users',uid), {
      email: currentUser.email,
      role: 'driver',
      active: true,
      createdAt: serverTimestamp()
    }, {merge:true});

    currentRole = 'driver';
    $('authStatus').textContent = `Connecté: ${currentUser.email} · UID: ${uid} · rôle: driver`;
    setAuthUiState(currentUser);

  }catch(e){
    console.error('Erreur rôle:', e);
    currentRole = email === 'allaouaboucheneb04@gmail.com' ? 'admin' : 'driver';
    $('authStatus').textContent = `Connecté: ${currentUser.email} · UID: ${uid} · rôle: ${currentRole}`;
    setAuthUiState(currentUser);
  }
}
function setSync(text, ok){ const b=$('syncBadge'); b.textContent=text; b.className=ok?'badge':'badge warn'; }
function bindRealtime(){
  unsubscribers.forEach(u=>u()); unsubscribers=[];
  if(!firebaseReady) return;
  unsubscribers.push(onSnapshot(collection(db,'lines'), s=>{state.lines=s.docs.map(d=>({id:d.id,...d.data()})); renderAll();}));
  unsubscribers.push(onSnapshot(collection(db,'stops'), s=>{state.stops=s.docs.map(d=>({id:d.id,...d.data()})); renderAll();}));
  unsubscribers.push(onSnapshot(query(collection(db,'vehicles'), where('status','==','active')), s=>{state.vehicles=s.docs.map(d=>({id:d.id,...d.data()})); renderAll();}));
}
function localDemo(){return {lines:[{id:'demo_l1',name:'Bus 01 - Centre Béjaïa',type:'bus',color:'#2563eb'},{id:'demo_l2',name:'Bus 02 - Université',type:'bus',color:'#16a34a'}],stops:[{id:'demo_s1',lineId:'demo_l1',name:'Gare routière Béjaïa',lat:36.7509,lng:5.0567},{id:'demo_s2',lineId:'demo_l1',name:'Centre-ville',lat:36.7555,lng:5.0741},{id:'demo_s3',lineId:'demo_l2',name:'Université Abderrahmane Mira',lat:36.7117,lng:5.0489},{id:'demo_s4',lineId:'demo_l2',name:'Targa Ouzemour',lat:36.7256,lng:5.0552}],vehicles:[{id:'demo_v1',name:'Bus 12',lineId:'demo_l1',lat:36.753,lng:5.064,status:'active',driverName:'Démo',updatedAt:Date.now()},{id:'demo_v2',name:'Bus 21',lineId:'demo_l2',lat:36.721,lng:5.053,status:'active',driverName:'Démo',updatedAt:Date.now()}]};}
function data(){ return firebaseReady ? state : localDemo(); }
function initMap(){ map=L.map('map').setView(BEJAIA_CENTER,13); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map); }
function clearMarkers(){ markers.forEach(m=>m.remove()); markers=[]; }
function fillSelect(el, items, placeholder){ const old=el.value; el.innerHTML=`<option value="">${placeholder}</option>`+items.map(i=>`<option value="${i.id}">${i.name}</option>`).join(''); if(items.some(i=>i.id===old)) el.value=old; }
function lineName(id){ return (data().lines.find(l=>l.id===id)||{}).name || 'Sans ligne'; }
function empty(t){ return `<p class="result-text">${t}</p>`; }
function renderAll(){
  const d=data(); ['clientLineSelect','driverLineSelect','stopLineSelect','vehicleLineSelect'].forEach(id=>fillSelect($(id), d.lines, id==='clientLineSelect'?'Toutes les lignes':'Choisir une ligne'));
  fillSelect($('driverVehicleSelect'), d.vehicles, 'Choisir véhicule'); renderLists(); drawMap();
}
function renderLists(){
  const d=data(), lineId=$('clientLineSelect').value, stops=d.stops.filter(s=>!lineId||s.lineId===lineId);
  $('stopsCount').textContent=stops.length;
  $('stopsList').innerHTML=stops.map((s,i)=>`<div class="item-card"><div><strong>${i+1}. ${s.name}</strong><small>${lineName(s.lineId)}</small><div class="meta"><span class="pill">${Number(s.lat).toFixed(5)}, ${Number(s.lng).toFixed(5)}</span></div></div></div>`).join('')||empty('Aucun arrêt.');
  $('linesAdminList').innerHTML=d.lines.map(l=>`<div class="item-card"><div><strong>${l.name}</strong><small>${l.type}</small></div><button class="delete" onclick="deleteLine('${l.id}')">Supprimer</button></div>`).join('')||empty('Aucune ligne.');
  $('stopsAdminList').innerHTML=d.stops.map(s=>`<div class="item-card"><div><strong>${s.name}</strong><small>${lineName(s.lineId)}</small></div><button class="delete" onclick="deleteStop('${s.id}')">Supprimer</button></div>`).join('')||empty('Aucun arrêt.');
  $('vehiclesAdminList').innerHTML=d.vehicles.map(v=>`<div class="item-card"><div><strong>${v.name}</strong><small>${lineName(v.lineId)} · ${v.status||'offline'} · ${v.driverName||''}</small></div><button class="delete" onclick="deleteVehicle('${v.id}')">Supprimer</button></div>`).join('')||empty('Aucun véhicule.');
}
function drawMap(){
  if(!map) return; const d=data(), lineId=$('clientLineSelect').value; clearMarkers();
  const stops=d.stops.filter(s=>!lineId||s.lineId===lineId), vehicles=d.vehicles.filter(v=>!lineId||v.lineId===lineId);
  stops.forEach(s=>markers.push(L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',html:'<div class="stop-dot"></div>'})}).addTo(map).bindPopup(`<b>${s.name}</b><br>${lineName(s.lineId)}`)));
  vehicles.forEach(v=>markers.push(L.marker([v.lat,v.lng],{icon:L.divIcon({className:'',html:`<div class="bus-marker">🚍 ${v.name}</div>`})}).addTo(map).bindPopup(`<b>${v.name}</b><br>${lineName(v.lineId)}<br>${v.driverName||''}`)));
  const all=[...stops.map(s=>[s.lat,s.lng]),...vehicles.map(v=>[v.lat,v.lng])]; if(all.length && !clientMapCenteredByGps) map.fitBounds(all,{padding:[40,40],maxZoom:14});
}
function requireAdmin(){ if(!firebaseReady) return alert('Configure Firebase avant.'); if(!currentUser) return alert('Connecte-toi d’abord.'); if(currentRole!=='admin') return alert('Compte admin requis. Ton UID est: '+currentUser.uid); return true; }
async function addLine(){ if(!requireAdmin()) return; const name=$('lineName').value.trim(); if(!name) return alert('Nom ligne obligatoire.'); await addDoc(collection(db,'lines'),{name,type:$('lineType').value,color:$('lineColor').value,city:'bejaia',createdAt:serverTimestamp()}); $('lineName').value=''; }
async function addStop(){ if(!requireAdmin()) return; const lineId=$('stopLineSelect').value,name=$('stopName').value.trim(),lat=parseFloat($('stopLat').value),lng=parseFloat($('stopLng').value); if(!lineId||!name||isNaN(lat)||isNaN(lng)) return alert('Remplis ligne, nom, latitude, longitude.'); await addDoc(collection(db,'stops'),{lineId,name,lat,lng,city:'bejaia',createdAt:serverTimestamp()}); ['stopName','stopLat','stopLng'].forEach(id=>$(id).value=''); }
async function addVehicle(){ if(!requireAdmin()) return; const name=$('vehicleName').value.trim(), lineId=$('vehicleLineSelect').value; if(!name||!lineId) return alert('Remplis véhicule et ligne.'); await addDoc(collection(db,'vehicles'),{name,lineId,lat:BEJAIA_CENTER[0],lng:BEJAIA_CENTER[1],status:'offline',driverName:'',updatedAt:serverTimestamp(),city:'bejaia'}); $('vehicleName').value=''; }
window.deleteLine=async id=>{ if(requireAdmin()) await deleteDoc(doc(db,'lines',id)); };
window.deleteStop=async id=>{ if(requireAdmin()) await deleteDoc(doc(db,'stops',id)); };
window.deleteVehicle=async id=>{ if(requireAdmin()) await deleteDoc(doc(db,'vehicles',id)); };
async function seedDemo(){ if(!requireAdmin()) return; const demo=localDemo(), batch=writeBatch(db); demo.lines.forEach(x=>batch.set(doc(db,'lines',x.id), {...x,city:'bejaia'})); demo.stops.forEach(x=>batch.set(doc(db,'stops',x.id), {...x,city:'bejaia'})); demo.vehicles.forEach(x=>batch.set(doc(db,'vehicles',x.id), {...x,city:'bejaia'})); await batch.commit(); alert('Données démo ajoutées.'); }
async function clearDemo(){ if(!requireAdmin()) return; const batch=writeBatch(db); for(const col of ['lines','stops','vehicles']){ const s=await getDocs(collection(db,col)); s.docs.filter(d=>d.id.startsWith('demo_')).forEach(d=>batch.delete(d.ref)); } await batch.commit(); }
function startTrip(){
  if(!firebaseReady || !currentUser) return alert('Connecte-toi comme chauffeur.');
  const vehicleId=$('driverVehicleSelect').value,lineId=$('driverLineSelect').value,driverName=$('driverName').value.trim()||currentUser.email||'Chauffeur', interval=parseInt($('gpsInterval').value,10);
  if(!vehicleId||!lineId) return alert('Choisis véhicule et ligne.'); if(!navigator.geolocation) return alert('GPS non disponible.');
  lastGpsWrite=0; if(gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId=navigator.geolocation.watchPosition(async pos=>{ const now=Date.now(); if(now-lastGpsWrite<interval) return; lastGpsWrite=now; await setDoc(doc(db,'vehicles',vehicleId),{lineId,driverId:currentUser.uid,driverName,lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy,status:'active',updatedAt:serverTimestamp(),city:'bejaia'}, {merge:true}); $('driverStatus').textContent='GPS actif · dernière mise à jour '+new Date().toLocaleTimeString(); }, err=>$('driverStatus').textContent='Erreur GPS: '+err.message,{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
}
async function stopTrip(){ if(gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId=null; const vehicleId=$('driverVehicleSelect').value; if(firebaseReady&&vehicleId) await setDoc(doc(db,'vehicles',vehicleId),{status:'offline',updatedAt:serverTimestamp()},{merge:true}); $('driverStatus').textContent='GPS arrêté.'; }
function routeSearch(){ const from=$('fromInput').value.trim().toLowerCase(),to=$('toInput').value.trim().toLowerCase(),lineId=$('clientLineSelect').value; const stops=data().stops.filter(s=>!lineId||s.lineId===lineId).map(s=>s.name.toLowerCase()); $('routeResult').textContent=(!from||!to)?'Entre un départ et une destination.':(stops.some(s=>s.includes(from))&&stops.some(s=>s.includes(to))?'Trajet possible sur cette ligne.':'Aucun trajet trouvé. Ajoute les arrêts dans Admin.'); }
function bind(){
  document.querySelectorAll('.nav-btn').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));$('page-'+btn.dataset.page).classList.add('active');setTimeout(()=>map&&map.invalidateSize(),200);});
  document.querySelectorAll('.mini').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.mini').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.admin-pane').forEach(p=>p.classList.remove('active'));$('admin-'+btn.dataset.adminTab).classList.add('active');});
  $('loginOpenBtn').onclick=()=>{$('loginModal').classList.remove('hidden'); if(auth && auth.currentUser) setAuthUiState(auth.currentUser);};
  $('closeLoginBtn').onclick=()=>{$('loginModal').classList.add('hidden');};
  function friendlyAuthError(e){
    const code = e && e.code ? e.code : '';
    if(code.includes('auth/invalid-credential')) return 'Email ou mot de passe incorrect.';
    if(code.includes('auth/user-not-found')) return 'Compte introuvable. Crée-le dans Firebase Authentication.';
    if(code.includes('auth/wrong-password')) return 'Mot de passe incorrect.';
    if(code.includes('auth/email-already-in-use')) return 'Ce compte existe déjà. Clique Se connecter.';
    if(code.includes('auth/operation-not-allowed')) return 'Active Email/Password dans Firebase Authentication.';
    if(code.includes('auth/unauthorized-domain')) return 'Ajoute ton domaine GitHub Pages dans Firebase Authentication > Settings > Authorized domains.';
    return e.message || 'Erreur de connexion.';
  }
  $('loginBtn').onclick=async()=>{try{const cred=await signInWithEmailAndPassword(auth,$('emailInput').value.trim(),$('passwordInput').value); currentUser=cred.user; await loadRole(); setAuthUiState(currentUser); $('loginModal').classList.add('hidden'); alert('Connexion réussie ✅')}catch(e){ showAuthErrorFinal(e) }};
  $('signupBtn').onclick=async()=>{try{await createUserWithEmailAndPassword(auth,$('emailInput').value.trim(),$('passwordInput').value);$('authStatus').textContent='Compte créé. Ajoute ton UID dans admins pour devenir admin.';}catch(e){ showAuthErrorFinal(e) }};
  $('logoutBtn').onclick=()=>signOut(auth); $('clientLineSelect').onchange=()=>{renderLists();drawMap();};
  $('addLineBtn').onclick=addLine; $('addStopBtn').onclick=addStop; $('addVehicleBtn').onclick=addVehicle; $('seedBtn').onclick=seedDemo; $('clearDemoBtn').onclick=clearDemo;
  $('startTripBtn').onclick=startTrip; $('stopTripBtn').onclick=stopTrip; $('routeBtn').onclick=routeSearch;
  $('useMyLocationStop').onclick=()=>navigator.geolocation.getCurrentPosition(
    p=>{$('stopLat').value=p.coords.latitude.toFixed(6);$('stopLng').value=p.coords.longitude.toFixed(6);},
    e=>alert(e.code===1?'GPS refusé pour ce site. Autorise la position dans Safari puis recharge.':'GPS impossible: '+e.message),
    {enableHighAccuracy:true, timeout:20000, maximumAge:0}
  );
}
window.addEventListener('load',()=>{initMap();bind();initFirebase(); if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');});


// Correctif visibilité boutons connexion iPhone/Safari
function fixLoginModalButtons(){
  ['loginBtn','signupBtn','logoutBtn','closeLoginBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){
      el.style.display = 'block';
      el.style.width = '100%';
      el.style.minHeight = '52px';
      el.style.marginTop = '12px';
      el.style.opacity = '1';
      el.style.visibility = 'visible';
      el.style.position = 'relative';
      el.style.zIndex = '9999';
    }
  });
}
setTimeout(fixLoginModalButtons, 300);
document.addEventListener('click', ()=>setTimeout(fixLoginModalButtons, 50));


// --- Correctif UI connexion/admin ---
function setAuthUiState(user){
  const topBtns = [
    document.getElementById('loginOpenBtn'),
    document.getElementById('openLogin'),
    document.getElementById('loginBtnTop'),
    document.getElementById('connectBtn'),
    document.querySelector('[data-open-login]')
  ].filter(Boolean);

  topBtns.forEach(btn=>{
    if(user){
      btn.textContent = 'Connecté';
      btn.classList.add('is-connected');
    }else{
      btn.textContent = 'Connexion';
      btn.classList.remove('is-connected');
    }
  });

  const status = document.getElementById('authStatus');
  if(status){
    status.textContent = user ? ('Connecté: ' + user.email + ' · rôle: ' + (currentRole || '...')) : 'Non connecté';
  }
}

// Correctif final affichage erreurs connexion
function showAuthErrorFinal(e){
  const msg = (e && e.code) ? e.code + " - " + (e.message || "") : String(e);
  const status = document.getElementById('authStatus');
  if(status) status.textContent = msg;
  alert("Erreur connexion: " + msg);
}


// ================================
// Sélecteur carte pour arrêts
// ================================
let stopPickerMap = null;
let stopPickerMarker = null;
let pickedStopLat = null;
let pickedStopLng = null;

function setStopPickedPosition(lat, lng){
  pickedStopLat = Number(lat);
  pickedStopLng = Number(lng);

  const latEl = document.getElementById('pickedLat');
  const lngEl = document.getElementById('pickedLng');
  if(latEl) latEl.textContent = pickedStopLat.toFixed(6);
  if(lngEl) lngEl.textContent = pickedStopLng.toFixed(6);

  if(stopPickerMarker){
    stopPickerMarker.setLatLng([pickedStopLat, pickedStopLng]);
  }else if(stopPickerMap){
    stopPickerMarker = L.marker([pickedStopLat, pickedStopLng], {draggable:true}).addTo(stopPickerMap);
    stopPickerMarker.on('dragend', ()=>{
      const p = stopPickerMarker.getLatLng();
      setStopPickedPosition(p.lat, p.lng);
    });
  }
}

function openStopMapPicker(){
  const modal = document.getElementById('stopMapPickerModal');
  if(!modal) return alert('Carte de sélection introuvable.');
  modal.classList.remove('hidden');

  setTimeout(()=>{
    const latInput = document.getElementById('stopLat') || document.getElementById('stopLatitude') || document.querySelector('input[placeholder*="Latitude"], input[name*="lat"]');
    const lngInput = document.getElementById('stopLng') || document.getElementById('stopLongitude') || document.querySelector('input[placeholder*="Longitude"], input[name*="lng"]');

    const startLat = parseFloat(latInput && latInput.value) || 36.7525;
    const startLng = parseFloat(lngInput && lngInput.value) || 5.0843;

    if(!stopPickerMap){
      stopPickerMap = L.map('stopPickerMap').setView([startLat, startLng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:'© OpenStreetMap'
      }).addTo(stopPickerMap);

      stopPickerMap.on('click', (e)=>{
        setStopPickedPosition(e.latlng.lat, e.latlng.lng);
      });
    }else{
      stopPickerMap.invalidateSize();
      stopPickerMap.setView([startLat, startLng], 14);
    }

    setStopPickedPosition(startLat, startLng);
    setTimeout(()=>stopPickerMap.invalidateSize(), 250);
  }, 150);
}

function confirmStopPickedPosition(){
  if(pickedStopLat == null || pickedStopLng == null) return alert('Choisis une position sur la carte.');

  const latInput = document.getElementById('stopLat') || document.getElementById('stopLatitude') || document.querySelector('input[placeholder*="Latitude"], input[name*="lat"]');
  const lngInput = document.getElementById('stopLng') || document.getElementById('stopLongitude') || document.querySelector('input[placeholder*="Longitude"], input[name*="lng"]');

  if(latInput) latInput.value = pickedStopLat.toFixed(6);
  if(lngInput) lngInput.value = pickedStopLng.toFixed(6);

  document.getElementById('stopMapPickerModal')?.classList.add('hidden');
}

function useMyLocationForStop(){
  if(!navigator.geolocation) return alert('GPS non disponible.');
  navigator.geolocation.getCurrentPosition((pos)=>{
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    setStopPickedPosition(lat, lng);
    if(stopPickerMap) stopPickerMap.setView([lat,lng], 17);
  }, ()=>{
    alert('GPS refusé. Active la localisation dans Safari.');
  }, {enableHighAccuracy:true, timeout:12000});
}

function installStopPickerButtons(){
  // Bouton professionnel sous les champs latitude/longitude
  const latInput = document.getElementById('stopLat') || document.getElementById('stopLatitude') || document.querySelector('input[placeholder*="Latitude"], input[name*="lat"]');
  if(latInput && !document.getElementById('openStopPickerBtn')){
    const btn = document.createElement('button');
    btn.id = 'openStopPickerBtn';
    btn.type = 'button';
    btn.className = 'btn primary';
    btn.textContent = '🗺️ Choisir sur la carte';
    btn.style.marginTop = '12px';
    btn.onclick = openStopMapPicker;

    const parent = latInput.closest('.field,.form-group,label,div') || latInput.parentElement;
    if(parent) parent.parentElement.insertBefore(btn, parent.nextSibling);
  }

  const useBtn = document.getElementById('useMyLocationForStopBtn');
  const confirmBtn = document.getElementById('confirmStopPositionBtn');
  const closeBtn = document.getElementById('closeStopPickerBtn');

  if(useBtn) useBtn.onclick = useMyLocationForStop;
  if(confirmBtn) confirmBtn.onclick = confirmStopPickedPosition;
  if(closeBtn) closeBtn.onclick = ()=>document.getElementById('stopMapPickerModal')?.classList.add('hidden');

  // Améliorer le bouton existant "Utiliser ma position" si présent
  document.querySelectorAll('button').forEach(b=>{
    if((b.textContent || '').trim().toLowerCase().includes('utiliser ma position') && b.id !== 'useMyLocationForStopBtn'){
      b.onclick = ()=>{
        if(!navigator.geolocation) return alert('GPS non disponible.');
        navigator.geolocation.getCurrentPosition((pos)=>{
          const latInput = document.getElementById('stopLat') || document.getElementById('stopLatitude') || document.querySelector('input[placeholder*="Latitude"], input[name*="lat"]');
          const lngInput = document.getElementById('stopLng') || document.getElementById('stopLongitude') || document.querySelector('input[placeholder*="Longitude"], input[name*="lng"]');
          if(latInput) latInput.value = pos.coords.latitude.toFixed(6);
          if(lngInput) lngInput.value = pos.coords.longitude.toFixed(6);
        }, ()=>alert('GPS refusé. Active la localisation dans Safari.'), {enableHighAccuracy:true, timeout:12000});
      };
    }
  });
}

setTimeout(installStopPickerButtons, 600);
document.addEventListener('click', ()=>setTimeout(installStopPickerButtons, 100));






// ================================
// Carte client centrée sur position - version finale iPhone/Safari
// ================================
let clientLocationMarker = null;
let clientGpsWatchId = null;

function showGpsMessage(message){
  const el = document.getElementById('routeResult');
  if(el) el.textContent = message;
}

function applyClientPosition(lat, lng, label='📍 Ma position'){
  if(typeof map === 'undefined' || !map) return;

  clientMapCenteredByGps = true;
  map.invalidateSize();
  map.setView([lat, lng], 16);

  if(clientLocationMarker){
    clientLocationMarker.setLatLng([lat, lng]);
  }else{
    clientLocationMarker = L.circleMarker([lat, lng], {
      radius: 10,
      weight: 3,
      fillOpacity: 0.85
    }).addTo(map).bindPopup(label);
  }

  clientLocationMarker.bindPopup(label).openPopup();
  showGpsMessage('Carte centrée sur ta position.');
}

function gpsErrorMessage(err){
  if(!err) return 'GPS impossible.';
  if(err.code === 1) return 'GPS refusé. Dans Safari: AA > Réglages du site web > Position > Autoriser.';
  if(err.code === 2) return 'Position indisponible. Active Wi‑Fi + données cellulaires, puis essaie près d’une fenêtre.';
  if(err.code === 3) return 'GPS trop long. Je lance un suivi GPS, attends quelques secondes.';
  return 'GPS impossible.';
}

function centerClientMapOnMyPosition(){
  if(!navigator.geolocation){
    showGpsMessage('GPS non disponible sur ce téléphone.');
    return;
  }

  showGpsMessage('Recherche de ta position GPS...');

  // Stop ancien suivi pour éviter doublons
  if(clientGpsWatchId !== null){
    navigator.geolocation.clearWatch(clientGpsWatchId);
    clientGpsWatchId = null;
  }

  // 1) Premier essai rapide: plus fiable sur iPhone/Safari que highAccuracy direct
  navigator.geolocation.getCurrentPosition((pos)=>{
    applyClientPosition(pos.coords.latitude, pos.coords.longitude);
  }, (err)=>{
    const msg = gpsErrorMessage(err);
    showGpsMessage(msg);

    if(err && err.code === 1){
      alert(msg);
      return;
    }

    // 2) Fallback iPhone: watchPosition trouve souvent la position après getCurrentPosition timeout
    clientGpsWatchId = navigator.geolocation.watchPosition((pos)=>{
      applyClientPosition(pos.coords.latitude, pos.coords.longitude);
      showGpsMessage('Position trouvée en suivi GPS.');
      if(clientGpsWatchId !== null){
        navigator.geolocation.clearWatch(clientGpsWatchId);
        clientGpsWatchId = null;
      }
    }, (e)=>{
      const msg2 = gpsErrorMessage(e);
      showGpsMessage(msg2);
      if(e && e.code === 1) alert(msg2);
    }, {
      enableHighAccuracy: false,
      timeout: 30000,
      maximumAge: 60000
    });

  }, {
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 60000
  });
}

function installClientGpsButton(){
  if(document.getElementById('centerClientGpsBtn')) return;

  const mapEl = document.getElementById('map');
  if(!mapEl) return;

  const wrap = mapEl.parentElement;
  wrap.style.position = 'relative';

  const btn = document.createElement('button');
  btn.id = 'centerClientGpsBtn';
  btn.type = 'button';
  btn.textContent = '📍 Ma position';
  btn.onclick = centerClientMapOnMyPosition;

  wrap.appendChild(btn);
}

setTimeout(installClientGpsButton, 800);
document.addEventListener('DOMContentLoaded', ()=>setTimeout(installClientGpsButton, 500));
