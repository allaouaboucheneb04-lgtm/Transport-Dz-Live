// Taxi Étoile Montreal - EmailJS configuration
// Sends 2 emails:
// 1) Admin notification to etoiletaximontreal@gmail.com
// 2) Client confirmation to the email entered in the form

const EMAILJS_PUBLIC_KEY = "yboy22jWUXe2Qfpak";
const EMAILJS_SERVICE_ID = "service_mq6perp";
const EMAILJS_TEMPLATE_ADMIN = "template_430p3gg";
const EMAILJS_TEMPLATE_CLIENT = "template_tt0etny";

(function () {
  if (window.emailjs) {
    emailjs.init(EMAILJS_PUBLIC_KEY);
  }
})();

function normalizeReservationData(raw) {
  raw = raw || {};

  return {
    client_name: raw.client_name || raw.name || raw.fullName || raw.nom || "",
    client_phone: raw.client_phone || raw.phone || raw.telephone || raw.tel || "",
    client_email: raw.client_email || raw.email || raw.mail || "",
    pickup: raw.pickup || raw.departure || raw.depart || raw.from || raw.adresse_depart || "",
    destination: raw.destination || raw.dropoff || raw.arrivee || raw.to || raw.adresse_destination || "",
    date: raw.date || raw.trip_date || raw.reservation_date || "",
    time: raw.time || raw.heure || raw.trip_time || "",
    passengers: raw.passengers || raw.passenger_count || raw.nb_passagers || "1",
    trip_type: raw.trip_type || raw.type || raw.trajet || "Aller simple",
    message: raw.message || raw.note || raw.notes || ""
  };
}

async function sendReservationEmails(rawData) {
  if (!window.emailjs) {
    console.error("EmailJS SDK not loaded. Add the EmailJS script before mail.js.");
    return false;
  }

  const data = normalizeReservationData(rawData);

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ADMIN, data);

    if (data.client_email) {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_CLIENT, data);
    }

    console.log("EmailJS: admin + client confirmation sent.");
    return true;
  } catch (error) {
    console.error("EmailJS error:", error);
    return false;
  }
}

// Backward compatibility with old code names
window.sendReservationEmails = sendReservationEmails;
window.sendReservation = sendReservationEmails;
window.sendReservationEmail = sendReservationEmails;
