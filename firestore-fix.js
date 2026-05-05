
/* Firestore direct save fix for Stablev2 */
(function(){
  const $ = (id) => document.getElementById(id);
  const qa = (s) => Array.from(document.querySelectorAll(s));

  function ready(fn){
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function getDb(){
    if(window.db) return window.db;
    if(window.firebase && firebase.firestore) {
      if(!firebase.apps.length && window.firebaseConfig) firebase.initializeApp(window.firebaseConfig);
      return firebase.firestore();
    }
    return null;
  }

  function now(){
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function valueByIds(ids, fallback=""){
    for(const id of ids){
      const el = $(id);
      if(el && typeof el.value !== "undefined" && String(el.value).trim() !== "") return String(el.value).trim();
    }
    return fallback;
  }

  function findInputNear(labelWords){
    const labels = qa("label");
    for(const lab of labels){
      const t = (lab.textContent || "").toLowerCase();
      if(labelWords.every(w => t.includes(w))){
        if(lab.htmlFor && $(lab.htmlFor)) return $(lab.htmlFor);
        let p = lab.parentElement;
        if(p){
          const input = p.querySelector("input,select,textarea");
          if(input) return input;
        }
        let next = lab.nextElementSibling;
        while(next){
          if(next.matches && next.matches("input,select,textarea")) return next;
          const inside = next.querySelector && next.querySelector("input,select,textarea");
          if(inside) return inside;
          next = next.nextElementSibling;
        }
      }
    }
    return null;
  }

  function valSmart(ids, labelWords, fallback=""){
    const byId = valueByIds(ids, "");
    if(byId) return byId;
    const el = findInputNear(labelWords);
    if(el && typeof el.value !== "undefined" && String(el.value).trim() !== "") return String(el.value).trim();
    return fallback;
  }

  function statusAfter(btn, id, msg, ok=true){
    let el = $(id);
    if(!el){
      el = document.createElement("div");
      el.id = id;
      el.style.marginTop = "10px";
      el.style.padding = "10px 12px";
      el.style.borderRadius = "12px";
      el.style.fontWeight = "800";
      if(btn && btn.parentElement) btn.parentElement.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = ok ? "#dcfce7" : "#fee2e2";
    el.style.color = ok ? "#166534" : "#dc2626";
  }

  async function save(collection, data, btn, statusId){
    try{
      const db = getDb();
      if(!db) throw new Error("Firebase Firestore non chargé");
      const ref = await db.collection(collection).add(data);
      statusAfter(btn, statusId, "✅ Enregistré dans Firebase: " + collection + " / " + ref.id, true);
      return ref;
    }catch(e){
      const msg = "❌ Erreur Firebase: " + (e.code || "") + " " + (e.message || e);
      statusAfter(btn, statusId, msg, false);
      alert(msg);
      throw e;
    }
  }

  function buttonTextIncludes(btn, words){
    const t = (btn.textContent || "").toLowerCase();
    return words.every(w => t.includes(w));
  }

  function findLineButton(){
    return $("addLineBtn") || $("saveLineBtn") || qa("button").find(b => buttonTextIncludes(b, ["ligne"]) && !buttonTextIncludes(b, ["supprimer"]));
  }

  function findStopButton(){
    return $("addStopBtn") || $("saveStopBtn") || qa("button").find(b => (buttonTextIncludes(b, ["arrêt"]) || buttonTextIncludes(b, ["arret"])) && !buttonTextIncludes(b, ["supprimer"]) && !buttonTextIncludes(b, ["carte"]));
  }

  function findDriverButton(){
    return $("addDriverBtn") || $("saveDriverBtn") || qa("button").find(b => buttonTextIncludes(b, ["chauffeur"]) && !buttonTextIncludes(b, ["supprimer"]));
  }

  function installLineSave(){
    const btn = findLineButton();
    if(!btn || btn.dataset.firestoreDirectLine) return;
    btn.dataset.firestoreDirectLine = "1";
    btn.addEventListener("click", async function(e){
      const name = valSmart(["lineName","nomLigne","ligneName","lineNom"], ["nom", "ligne"], "");
      const city = valSmart(["lineCity","city","ville"], ["ville"], "Bejaia");
      const type = valSmart(["lineType","typeLigne"], ["type"], "bus");
      const color = valSmart(["lineColor","couleur"], ["couleur"], "#2563eb");
      if(!name){
        statusAfter(btn, "firestoreLineStatus", "❌ Nom ligne obligatoire", false);
        return;
      }
      await save("lines", {
        name, city, type, color,
        active: true,
        createdAt: now(),
        updatedAt: now()
      }, btn, "firestoreLineStatus");
    }, true);
  }

  function installStopSave(){
    const btn = findStopButton();
    if(!btn || btn.dataset.firestoreDirectStop) return;
    btn.dataset.firestoreDirectStop = "1";
    btn.addEventListener("click", async function(e){
      const name = valSmart(["stopName","nomArret","arretName","stopNom"], ["nom", "arr"], "");
      const lineId = valSmart(["stopLineSelect","lineSelect","ligneArret","stopLine"], ["ligne"], "");
      const lat = Number(valSmart(["stopLat","latitude","stopLatitude","lat"], ["latitude"], ""));
      const lng = Number(valSmart(["stopLng","longitude","stopLongitude","lng"], ["longitude"], ""));
      if(!name){
        statusAfter(btn, "firestoreStopStatus", "❌ Nom arrêt obligatoire", false);
        return;
      }
      if(!Number.isFinite(lat) || !Number.isFinite(lng)){
        statusAfter(btn, "firestoreStopStatus", "❌ Latitude/longitude invalide", false);
        return;
      }
      await save("stops", {
        name, lineId, lat, lng,
        active: true,
        createdAt: now(),
        updatedAt: now()
      }, btn, "firestoreStopStatus");
    }, true);
  }

  function installDriverSave(){
    const btn = findDriverButton();
    if(!btn || btn.dataset.firestoreDirectDriver) return;
    btn.dataset.firestoreDirectDriver = "1";
    btn.addEventListener("click", async function(e){
      const name = valSmart(["driverName","nomChauffeur","chauffeurName","driverNameAdmin"], ["nom", "chauffeur"], "");
      const phone = valSmart(["driverPhone","phoneChauffeur","chauffeurPhone","driverPhoneAdmin"], ["téléphone"], "");
      const email = valSmart(["driverEmail","emailChauffeur","chauffeurEmail","driverEmailAdmin"], ["email"], "");
      if(!name){
        statusAfter(btn, "firestoreDriverStatus", "❌ Nom chauffeur obligatoire", false);
        return;
      }
      await save("drivers", {
        name, phone, email, uid: email,
        active: true,
        createdAt: now(),
        updatedAt: now()
      }, btn, "firestoreDriverStatus");
    }, true);
  }

  function listenAndPopulateLines(){
    const db = getDb();
    if(!db) return;
    db.collection("lines").onSnapshot(snap => {
      const lines = snap.docs.map(d => ({id:d.id, ...d.data()}));
      ["stopLineSelect","lineSelect","stopLine","ligneArret","vehicleLineSelect"].forEach(id => {
        const sel = $(id);
        if(!sel) return;
        const old = sel.value;
        sel.innerHTML = '<option value="">Choisir une ligne</option>' + lines.map(l => `<option value="${l.id}">${l.name || l.id}</option>`).join("");
        if(Array.from(sel.options).some(o => o.value === old)) sel.value = old;
      });
    });
  }

  function addManualTest(){
    if($("firestoreTestBox")) return;
    const box = document.createElement("div");
    box.id = "firestoreTestBox";
    box.style.cssText = "margin:16px;padding:12px;border:1px solid #dbe4f0;border-radius:16px;background:#fff;";
    box.innerHTML = '<b>Test Firebase</b><br><button id="manualFirestoreTestBtn" type="button">Tester écriture Firestore</button><div id="manualFirestoreStatus"></div>';
    document.body.appendChild(box);
    $("manualFirestoreTestBtn").onclick = () => save("lines", {name:"TestFirebaseDirect", city:"Test", type:"bus", color:"#2563eb", active:true, createdAt:now(), updatedAt:now()}, $("manualFirestoreTestBtn"), "manualFirestoreStatus");
  }

  function init(){
    installLineSave();
    installStopSave();
    installDriverSave();
    listenAndPopulateLines();
    addManualTest();
    setInterval(() => {
      installLineSave();
      installStopSave();
      installDriverSave();
    }, 1000);
  }

  ready(() => setTimeout(init, 700));
})();
