const firebaseConfig = {
  apiKey: "AIzaSyAPfRxnxmu2IRQIUF-U4qpIlVG95MCSABA",
  authDomain: "transport-dz-live-5d1fb.firebaseapp.com",
  projectId: "transport-dz-live-5d1fb",
  storageBucket: "transport-dz-live-5d1fb.firebasestorage.app",
  messagingSenderId: "512618434438",
  appId: "1:512618434438:web:0cadfb3ba155cce34ae607",
  measurementId: "G-1496GEGBV7"
};

if (typeof firebase !== "undefined" && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
window.auth = firebase.auth();
window.db = firebase.firestore();
