
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  writeBatch,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = window.FIREBASE_CONFIG || {
  apiKey: "AIzaSyBU6OYKH1GNa6ijTJ_7v87jmoTpHkDQoaQ",
  authDomain: "etoile-taxi.firebaseapp.com",
  projectId: "etoile-taxi",
  storageBucket: "etoile-taxi.firebasestorage.app",
  messagingSenderId: "685451587801",
  appId: "1:685451587801:web:b6a787fac14a3a30250ec8",
  measurementId: "G-FLRMDHE1N0"
};

let app;
let db;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  console.log("Firebase connecté.");
} catch (error) {
  console.error("Erreur Firebase init:", error);
}

const RESERVATIONS_COLLECTION = "reservations";

function $(id) {
  return document.getElementById(id);
}

function val(id) {
  const el = $(id);
  return el ? String(el.value || "").trim() : "";
}

function setVal(id, value) {
  const el = $(id);
  if (el) el.value = value || "";
}

function checked(id) {
  const el = $(id);
  return !!(el && el.checked);
}

function splitDateTime(value) {
  if (!value) return { date: "", time: "" };
  const [date, rawTime = ""] = String(value).split("T");
  return { date, time: rawTime.slice(0, 5) };
}

function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showMessage(message, type = "info") {
  let box = $("formMessage");
  if (!box) {
    box = document.createElement("div");
    box.id = "formMessage";
    const form = $("reservationForm");
    form?.prepend(box);
  }
  box.className = `form-message ${type}`;
  box.textContent = message;
  box.classList.remove("hidden");
}

function hideMessage() {
  const box = $("formMessage");
  if (box) box.classList.add("hidden");
}

function setLoading(isLoading) {
  const btn = document.querySelector("#reservationForm button[type='submit']");
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Envoi en cours..." : "Envoyer la réservation →";
}

function buildReservation() {
  const dt = splitDateTime(val("heure"));
  const retourDt = splitDateTime(val("heureRetour"));
  const isReturn = checked("allerRetour");

  const base = {
    clientName: val("nom"),
    name: val("nom"),
    phone: val("telephone"),
    email: val("email"),
    passengers: Number(val("passagers") || 1),
    flightNumber: val("numeroVol"),
    pickup: val("depart"),
    dropoff: val("arrivee"),
    destination: val("arrivee"),
    datetime: val("heure"),
    date: dt.date,
    time: dt.time,
    vehicleType: val("vehicule") || "berline",
    luggage: Number(val("valises") || 0),
    notes: val("notes"),
    tripType: isReturn ? "Aller-retour" : "Aller simple",
    allerRetour: isReturn,
    status: "pending",
    source: "site-web",
    createdAt: serverTimestamp()
  };

  const retour = {
    pickup: val("retourDepart") || base.dropoff,
    dropoff: val("retourArrivee") || base.pickup,
    datetime: val("heureRetour"),
    date: retourDt.date,
    time: retourDt.time,
    flightNumber: val("retourNumeroVol"),
    notes: val("notesRetour")
  };

  const emailParams = {
    name: base.name,
    phone: base.phone,
    email: base.email,
    client_name: base.name,
    client_phone: base.phone,
    client_email: base.email,

    pickup: base.pickup,
    destination: base.destination,
    date: base.date,
    time: base.time,
    passengers: String(base.passengers),
    trip_type: base.tripType,
    is_round_trip: base.allerRetour,
    message: base.notes || "",

    vehicle: base.vehicleType,
    luggage: String(base.luggage),
    flight_number: base.flightNumber || "",

    return_pickup: base.allerRetour ? retour.pickup : "",
    return_destination: base.allerRetour ? retour.dropoff : "",
    return_date: base.allerRetour ? retour.date : "",
    return_time: base.allerRetour ? retour.time : "",
    return_flight_number: base.allerRetour ? (retour.flightNumber || "") : "",
    return_notes: base.allerRetour ? (retour.notes || "") : "",

    retour_depart: base.allerRetour ? retour.pickup : "",
    retour_arrivee: base.allerRetour ? retour.dropoff : "",
    retour_date: base.allerRetour ? retour.date : "",
    retour_time: base.allerRetour ? retour.time : "",
    retour_heure: base.allerRetour ? (retour.time || "") : "",
    retour_numero_vol: base.allerRetour ? (retour.flightNumber || "") : "",
    retour_notes: base.allerRetour ? (retour.notes || "") : ""
  };

  return { base, retour, emailParams };
}

async function saveToFirebase(base, retour) {
  if (!db) {
    throw new Error("Firebase n’est pas initialisé.");
  }

  if (base.allerRetour) {
    const batch = writeBatch(db);
    const allerRef = doc(collection(db, RESERVATIONS_COLLECTION));
    const retourRef = doc(collection(db, RESERVATIONS_COLLECTION));
    const groupId = `rt_${Date.now()}`;

    batch.set(allerRef, {
      ...base,
      direction: "aller",
      groupId,
      linkedTripId: retourRef.id
    });

    batch.set(retourRef, {
      ...base,
      pickup: retour.pickup,
      dropoff: retour.dropoff,
      destination: retour.dropoff,
      datetime: retour.datetime || base.datetime,
      date: retour.date || base.date,
      time: retour.time || base.time,
      flightNumber: retour.flightNumber || "",
      notes: retour.notes || "",
      direction: "retour",
      groupId,
      linkedTripId: allerRef.id
    });

    await batch.commit();
    return;
  }

  await addDoc(collection(db, RESERVATIONS_COLLECTION), {
    ...base,
    direction: "aller-simple"
  });
}

async function sendEmails(emailParams) {
  if (!window.emailjs) {
    console.warn("EmailJS SDK non chargé.");
    return;
  }

  const publicKey = window.EMAILJS_PUBLIC_KEY || "yboy22jWUXe2Qfpak";
  const serviceId = window.EMAILJS_SERVICE_ID || "service_mq6perp";
  const adminTemplate = window.EMAILJS_ADMIN_TEMPLATE_ID || window.EMAILJS_TEMPLATE_ID || "template_430p3gg";
  const clientTemplate = window.EMAILJS_CLIENT_TEMPLATE_ID || "template_tt0etny";

  try {
    window.emailjs.init(publicKey);
  } catch (e) {}

  await window.emailjs.send(serviceId, adminTemplate, emailParams);

  if (emailParams.email) {
    await window.emailjs.send(serviceId, clientTemplate, emailParams);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  hideMessage();

  const form = $("reservationForm");
  if (!form) return;

  if (!form.reportValidity()) {
    return;
  }

  setLoading(true);

  // Validation retour
  if (checked("allerRetour")) {
    const departDate = new Date(val("heure"));
    const retourDate = new Date(val("heureRetour"));

    if (retourDate < departDate) {
      alert("La date/heure du retour doit être après le trajet aller.");
      setLoading(false);
      return;
    }
  }

  showMessage("Envoi de la réservation...", "info");

  try {
    const { base, retour, emailParams } = buildReservation();

    await saveToFirebase(base, retour);

    try {
      await sendEmails(emailParams);
    } catch (emailError) {
      console.error("EmailJS error:", emailError);
      showMessage("Réservation enregistrée. Attention: l’email n’a pas été envoyé.", "info");
    }

    form.reset();
    showMessage("Réservation envoyée avec succès.", "success");

    setTimeout(() => {
      window.location.href = "merci.html";
    }, 1000);

  } catch (error) {
    console.error("Erreur réservation:", error);
    showMessage("Erreur réservation: " + (error.message || "Vérifiez les règles Firebase."), "error");
  } finally {
    setLoading(false);
  }
}

/* Adresse autocomplete gratuit */
const AUTOCOMPLETE_CACHE = new Map();

async function fetchAddressSuggestions(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];

  if (AUTOCOMPLETE_CACHE.has(q)) return AUTOCOMPLETE_CACHE.get(q);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(q + ", Québec, Canada")}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await response.json();

    const results = (data || []).map((item) => ({
      label: item.display_name,
      value: item.display_name
    }));

    AUTOCOMPLETE_CACHE.set(q, results);
    return results;
  } catch (error) {
    console.error("Autocomplete:", error);
    return [];
  }
}

function closeAutocomplete(container) {
  if (!container) return;
  container.innerHTML = "";
  container.style.display = "none";
}

function setupAutocomplete(inputId, resultsId) {
  const input = $(inputId);
  const results = $(resultsId);
  if (!input || !results) return;

  let timer;

  input.addEventListener("input", () => {
    clearTimeout(timer);

    const query = input.value.trim();
    if (query.length < 3) {
      closeAutocomplete(results);
      return;
    }

    timer = setTimeout(async () => {
      const suggestions = await fetchAddressSuggestions(query);

      if (!suggestions.length) {
        closeAutocomplete(results);
        return;
      }

      results.innerHTML = suggestions.map((item) => `<div class="autocomplete-item">${item.label}</div>`).join("");
      results.style.display = "block";

      results.querySelectorAll(".autocomplete-item").forEach((el, index) => {
        el.addEventListener("click", () => {
          input.value = suggestions[index].value;
          closeAutocomplete(results);
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
      });
    }, 250);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => closeAutocomplete(results), 180);
  });
}

function syncReturnUI() {
  const allerRetour = $("allerRetour");
  const retourFields = $("retourFields");
  const isReturn = !!allerRetour?.checked;

  if (retourFields) {
    retourFields.classList.toggle("hidden", !isReturn);
    retourFields.style.display = isReturn ? "grid" : "none";
  }

  ["retourDepart", "retourArrivee", "heureRetour"].forEach((id) => {
    const el = $(id);
    if (el) el.required = isReturn;
  });

  if (isReturn) {
    if (!val("retourDepart")) setVal("retourDepart", val("arrivee"));
    if (!val("retourArrivee")) setVal("retourArrivee", val("depart"));
  }
}

function setupUI() {
  setupAutocomplete("depart", "depart-results");
  setupAutocomplete("arrivee", "arrivee-results");
  setupAutocomplete("retourDepart", "retour-depart-results");
  setupAutocomplete("retourArrivee", "retour-arrivee-results");

  const form = $("reservationForm");
  if (form) form.addEventListener("submit", handleSubmit);
  $("allerRetour")?.addEventListener("change", syncReturnUI);
$("depart")?.addEventListener("input", () => {
    if ($("allerRetour")?.checked && !$("retourArrivee")?.dataset.edited) {
      setVal("retourArrivee", val("depart"));
    }
  });

  $("arrivee")?.addEventListener("input", () => {
    if ($("allerRetour")?.checked && !$("retourDepart")?.dataset.edited) {
      setVal("retourDepart", val("arrivee"));
    }
  });

  $("retourDepart")?.addEventListener("input", () => $("retourDepart").dataset.edited = "1");
  $("retourArrivee")?.addEventListener("input", () => $("retourArrivee").dataset.edited = "1");

  document.querySelectorAll(".quick-destination-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = $(btn.dataset.target || "arrivee");
      if (target) {
        target.value = btn.dataset.address || "";
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });

  document.querySelectorAll(".choose-car").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vehicule = $("vehicule");
      if (vehicule) vehicule.value = btn.dataset.car || "berline";
      $("reservationForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const minDate = new Date(Date.now() + 10 * 60000);
  if ($("heure")) $("heure").min = localInputValue(minDate);
  if ($("heureRetour")) $("heureRetour").min = localInputValue(minDate);

  syncReturnUI();
}

document.addEventListener("DOMContentLoaded", setupUI);
