
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, where, serverTimestamp, getDoc, getDocs, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const BEJAIA_CENTER = [36.7509, 5.0567];
let app, auth, db, currentUser=null, currentRole='guest', firebaseReady=false;
let map, markers=[], unsubscribers=[], gpsWatchId=null, lastGpsWrite=0;
let state={lines:[],stops:[],vehicles:[]};
const $ = id => document.getElementById(id);
const isConfigured = () => window.firebaseConfig && !String(window.firebaseConfig.apiKey||'').includes('REMPLACE');

function initFirebase(){
  if(!isConfigured()){ setSync('Config Firebase manquante', false); renderAll(); return; }
  app = initializeApp(window.firebaseConfig); auth=getAuth(app); db=getFirestore(app); firebaseReady=true; setSync('Firebase connecté', true);
  onAuthStateChanged(auth, async user=>{ currentUser=user; await loadRole(); bindRealtime(); renderAll(); });
}
async function loadRole(){
  currentRole='guest';
  if(!currentUser || !db) return;

  try{
    // Méthode admin simple : créer Firestore > admins > UID
    const adminSnap = await getDoc(doc(db,'admins',currentUser.uid));
    if(adminSnap.exists() && adminSnap.data().active !== false){
      currentRole = 'admin';
      $('authStatus').textContent = `Connecté: ${currentUser.email} · rôle: admin`;
      return;
    }

    // Sinon rôle classique dans users > UID
    const userRef = doc(db,'users',currentUser.uid);
    const userSnap = await getDoc(userRef);

    if(userSnap.exists()){
      currentRole = userSnap.data().role || 'driver';
    }else{
      await setDoc(userRef, {
        email: currentUser.email,
        role: 'driver',
        active: true,
        createdAt: serverTimestamp()
      }, {merge:true});
      currentRole = 'driver';
    }

    $('authStatus').textContent = `Connecté: ${currentUser.email} · rôle: ${currentRole}`;
  }catch(e){
    console.error('Erreur rôle:', e);
    currentRole='driver';
    $('authStatus').textContent = `Connecté: ${currentUser.email} · rôle temporaire chauffeur`;
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
  const all=[...stops.map(s=>[s.lat,s.lng]),...vehicles.map(v=>[v.lat,v.lng])]; if(all.length) map.fitBounds(all,{padding:[40,40],maxZoom:14});
}
function requireAdmin(){ if(!firebaseReady) return alert('Configure Firebase avant.'); if(currentRole!=='admin') return alert('Compte admin requis. Crée Firestore > admins > ton UID avec active=true'); return true; }
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
  $('loginOpenBtn').onclick=()=>$('loginModal').classList.remove('hidden'); $('closeLoginBtn').onclick=()=>$('loginModal').classList.add('hidden'); alert('Connexion réussie ✅');
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
  $('loginBtn').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('emailInput').value.trim(),$('passwordInput').value);$('loginModal').classList.add('hidden'); alert('Connexion réussie ✅')}catch(e){$('authStatus').textContent=friendlyAuthError(e)}};
  $('signupBtn').onclick=async()=>{try{await createUserWithEmailAndPassword(auth,$('emailInput').value.trim(),$('passwordInput').value);$('authStatus').textContent='Compte créé. Ajoute ton UID dans admins pour devenir admin.';}catch(e){$('authStatus').textContent=friendlyAuthError(e)}};
  $('logoutBtn').onclick=()=>signOut(auth); $('clientLineSelect').onchange=()=>{renderLists();drawMap();};
  $('addLineBtn').onclick=addLine; $('addStopBtn').onclick=addStop; $('addVehicleBtn').onclick=addVehicle; $('seedBtn').onclick=seedDemo; $('clearDemoBtn').onclick=clearDemo;
  $('startTripBtn').onclick=startTrip; $('stopTripBtn').onclick=stopTrip; $('routeBtn').onclick=routeSearch;
  $('useMyLocationStop').onclick=()=>navigator.geolocation.getCurrentPosition(p=>{$('stopLat').value=p.coords.latitude;$('stopLng').value=p.coords.longitude;});
}
window.addEventListener('load',()=>{initMap();bind();initFirebase(); if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');});


// Correctif visibilité boutons connexion iPhone/Safari
function fixLoginModalButtons(){
  ['loginBtn','signupBtn','logoutBtn','closeLogin'].forEach(id=>{
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
