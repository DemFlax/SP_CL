import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDy1txlYOzTAdiq4ohJjoUpO_vdUKLtYL8",
  authDomain: "demcalendar-a9010.firebaseapp.com",
  projectId: "demcalendar-a9010",
  storageBucket: "demcalendar-a9010.firebasestorage.app",
  messagingSenderId: "463581099746",
  appId: "1:463581099746:web:1cc114443735ea140090bb"
};

export const appsScriptConfig = {
  url: 'https://script.google.com/macros/s/AKfycbwfD3LhwCAhGhWtSlauYd-xVFioo8fAjIznCBw_PC1CtDRx1Z3Z5b4W2DK0_hAEtUup/exec',
  apiKey: 'demcalendar-2026-key'
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (location.hostname === 'localhost') {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 8082);
}

export default firebaseConfig;
