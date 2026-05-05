
(function(){
  const $ = id => document.getElementById(id);
  const qa = sel => Array.from(document.querySelectorAll(sel));
  let lines = [], stops = [], drivers = [];

  function ready(fn){ document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn(); }
  function database(){ return window.db || (window.firebase && firebase.firestore ? firebase.firestore() : null); }
  function now(){ return firebase.firestore.FieldValue.serverTimestamp(); }
  function signed(){ return window.auth && window.auth.currentUser; }

  function get(ids, fallback=""){
    for(const id of ids){
      const el = $(id);
      if(el && el.value !== undefined && String(el.value).trim() !== "") return String(el.value).trim();
    }
    return fallback;
  }

  function inputNear(labelWords){
    for(const lab of qa("label")){
      const t = (lab.textContent || "").toLowerCase();
      if(labelWords.every(w => t.includes(w))){
        if(lab.htmlFor && $(lab.htmlFor)) return $(lab.htmlFor);
        let n = lab.nextElementSibling;
        while(n){
          if(n.matches && n.matches("input,select,textarea")) return n;
          const found = n.querySelector && n.querySelector("input,select,textarea");
          if(found) return found;
          n = n.nextElementSibling;
        }
      }
    }
    return null;
  }

  function smart(ids, words, fallback=""){
    const byId = get(ids, "");
    if(byId) return byId;
    const el = inputNear(words);
    return el && el.value !== undefined && String(el.value).trim() !== "" ? String(el.value).trim() : fallback;
  }

  function btn(words, exclude=[]){
    return qa("button").find(b => {
      const t = (b.textContent || "").toLowerCase();
      return words.every(w => t.includes(w)) && !exclude.some(w => t.includes(w));
    });
  }

  function lineBtn(){ return $("addLineBtn") || $("saveLineBtn") || btn(["ligne"], ["supprimer"]); }
  function stopBtn(){ return $("addStopBtn") || $("saveStopBtn") || btn(["arrêt"], ["supprimer","carte"]) || btn(["arret"], ["supprimer","carte"]); }
  function driverBtn(){ return $("addDriverBtn") || $("saveDriverBtn") || btn(["chauffeur"], ["supprimer"]); }

  function status(button, id, msg, ok){
    let el = $(id);
    if(!el){
      el = document.createElement("div");
      el.id = id;
      el.style.marginTop = "10px";
      el.style.padding = "10px 12px";
      el.style.borderRadius = "12px";
      el.style.fontWeight = "800";
      if(button && button.parentElement) button.parentElement.appendChild(el);
      else document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = ok ? "#dcfce7" : "#fee2e2";
    el.style.color = ok ? "#166534" : "#dc2626";
  }

  async function save(collection, data, button, statusId){
    if(!database()){
      status(button, statusId, "❌ Firestore non chargé", false);
      alert("Firestore non chargé");
      return;
    }
    if(!signed()){
      status(button, statusId, "❌ Connecte-toi d’abord", false);
      alert("Connecte-toi d’abord");
      return;
    }
    try{
      const ref = await database().collection(collection).add(data);
      status(button, statusId, "✅ Sauvegardé Firebase: " + ref.id, true);
      return ref;
    }catch(e){
      const msg = "❌ Erreur Firestore: " + (e.code || "") + " " + (e.message || e);
      status(button, statusId, msg, false);
      alert(msg);
      console.error(e);
    }
  }

  async function addLine(e){
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const button = e.currentTarget;
    const name = smart(["lineName","nomLigne","ligneName","lineNom"], ["nom","ligne"], "");
    const city = smart(["lineCity","city","ville"], ["ville"], "Bejaia");
    const type = smart(["lineType","typeLigne"], ["type"], "bus");
    const color = smart(["lineColor","couleur"], ["couleur"], "#2563eb");
    if(!name) return status(button, "firestoreLineStatus", "❌ Nom ligne obligatoire", false);
    const ref = await save("lines", {name, city, type, color, active:true, createdAt:now(), updatedAt:now()}, button, "firestoreLineStatus");
    if(ref){
      const el = $("lineName") || $("nomLigne") || $("ligneName");
      if(el) el.value = "";
    }
  }

  async function addStop(e){
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const button = e.currentTarget;
    const name = smart(["stopName","nomArret","arretName","stopNom"], ["nom","arr"], "");
    const lineId = smart(["stopLineSelect","lineSelect","ligneArret","stopLine"], ["ligne"], "");
    const lat = Number(smart(["stopLat","latitude","stopLatitude","lat"], ["latitude"], ""));
    const lng = Number(smart(["stopLng","longitude","stopLongitude","lng"], ["longitude"], ""));
    if(!name) return status(button, "firestoreStopStatus", "❌ Nom arrêt obligatoire", false);
    if(!Number.isFinite(lat) || !Number.isFinite(lng)) return status(button, "firestoreStopStatus", "❌ Latitude/longitude invalide", false);
    const ref = await save("stops", {name, lineId, lat, lng, active:true, createdAt:now(), updatedAt:now()}, button, "firestoreStopStatus");
    if(ref){
      const el = $("stopName") || $("nomArret") || $("arretName");
      if(el) el.value = "";
    }
  }

  async function addDriver(e){
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const button = e.currentTarget;
    const name = smart(["driverName","nomChauffeur","chauffeurName","driverNameAdmin"], ["nom","chauffeur"], "");
    const phone = smart(["driverPhone","phoneChauffeur","chauffeurPhone","driverPhoneAdmin"], ["téléphone"], "");
    const email = smart(["driverEmail","emailChauffeur","chauffeurEmail","driverEmailAdmin"], ["email"], "");
    if(!name) return status(button, "firestoreDriverStatus", "❌ Nom chauffeur obligatoire", false);
    const ref = await save("drivers", {name, phone, email, uid:email, active:true, createdAt:now(), updatedAt:now()}, button, "firestoreDriverStatus");
    if(ref){
      const el = $("driverName") || $("nomChauffeur") || $("chauffeurName") || $("driverNameAdmin");
      if(el) el.value = "";
    }
  }

  function attach(){
    const lb = lineBtn();
    if(lb && !lb.dataset.fsTruth){ lb.dataset.fsTruth = "1"; lb.addEventListener("click", addLine, true); }
    const sb = stopBtn();
    if(sb && !sb.dataset.fsTruth){ sb.dataset.fsTruth = "1"; sb.addEventListener("click", addStop, true); }
    const dbtn = driverBtn();
    if(dbtn && !dbtn.dataset.fsTruth){ dbtn.dataset.fsTruth = "1"; dbtn.addEventListener("click", addDriver, true); }
  }

  function lineName(id){ const l = lines.find(x => x.id === id); return l ? (l.name || l.id) : (id || ""); }

  function renderLines(){
    const boxes = [ $("linesAdminList"), $("linesList"), $("lineList") ].filter(Boolean);
    const title = qa("*").find(el => (el.textContent || "").trim().toLowerCase() === "lignes enregistrées");
    if(title && title.parentElement && !boxes.includes(title.parentElement)) boxes.push(title.parentElement);

    for(const box of boxes){
      box.innerHTML = lines.length ? lines.map(l => `
        <div class="item">
          <strong>${l.name || l.id}</strong>
          <span class="muted">${l.city || ""} · ${l.type || "bus"}</span>
          <button type="button" class="deleteBtn" data-fs-del-line="${l.id}">Supprimer</button>
        </div>
      `).join("") : '<div class="muted">Aucune ligne.</div>';
    }

    qa("[data-fs-del-line]").forEach(b => {
      if(b.dataset.ready) return;
      b.dataset.ready = "1";
      b.onclick = async ev => {
        ev.preventDefault(); ev.stopPropagation();
        if(confirm("Supprimer cette ligne Firebase ?")) await database().collection("lines").doc(b.dataset.fsDelLine).delete();
      };
    });
  }

  function renderStops(){
    const box = $("stopsAdminList") || $("stopsList");
    if(box){
      box.innerHTML = stops.length ? stops.map(s => `
        <div class="item">
          <strong>🚏 ${s.name || s.id}</strong>
          <span class="muted">${lineName(s.lineId)} · ${s.lat}, ${s.lng}</span>
          <button type="button" class="deleteBtn" data-fs-del-stop="${s.id}">Supprimer</button>
        </div>
      `).join("") : '<div class="muted">Aucun arrêt.</div>';
    }
  }

  function renderDrivers(){
    const box = $("driversAdminList") || $("driversList");
    if(box){
      box.innerHTML = drivers.length ? drivers.map(d => `
        <div class="item">
          <strong>${d.name || d.id}</strong>
          <span class="muted">${d.phone || ""} · ${d.email || ""}</span>
        </div>
      `).join("") : '<div class="muted">Aucun chauffeur.</div>';
    }
  }

  function fillSelects(){
    ["stopLineSelect","lineSelect","stopLine","ligneArret","vehicleLineSelect","driverLineSelect"].forEach(id => {
      const sel = $(id);
      if(!sel) return;
      const old = sel.value;
      sel.innerHTML = '<option value="">Choisir une ligne</option>' + lines.map(l => `<option value="${l.id}">${l.name || l.id}</option>`).join("");
      if(Array.from(sel.options).some(o => o.value === old)) sel.value = old;
    });
  }

  function listen(){
    if(!database()) return;
    database().collection("lines").onSnapshot(snap => {
      lines = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderLines(); fillSelects();
    }, e => console.error(e));
    database().collection("stops").onSnapshot(snap => {
      stops = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderStops();
    }, e => console.error(e));
    database().collection("drivers").onSnapshot(snap => {
      drivers = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderDrivers();
    }, e => console.error(e));
  }

  function addTest(){
    if($("firestoreTestBox")) return;
    const box = document.createElement("div");
    box.id = "firestoreTestBox";
    box.className = "card";
    box.innerHTML = '<h3>Test Firebase</h3><button id="manualFirestoreTestBtn" type="button" class="primary">Tester écriture Firestore</button><div id="manualFirestoreStatus"></div>';
    const admin = $("adminPage") || document.body;
    admin.appendChild(box);
    $("manualFirestoreTestBtn").addEventListener("click", async e => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      await save("lines", {name:"TestFirebaseDirect", city:"Test", type:"bus", color:"#2563eb", active:true, createdAt:now(), updatedAt:now()}, $("manualFirestoreTestBtn"), "manualFirestoreStatus");
    }, true);
  }

  function init(){
    attach(); listen(); addTest();
    setInterval(attach, 700);
  }

  ready(() => setTimeout(init, 800));
})();
