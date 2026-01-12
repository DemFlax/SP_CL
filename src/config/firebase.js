// =========================================
// FIREBASE CONFIG - SECURITY FIX C1
// =========================================
// Version: 2.0 (API key removed)
// Date: 2025-11-05
// =========================================

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

// ✅ APPS SCRIPT CONFIG ELIMINADO (ahora en Secret Manager backend)

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (location.hostname === 'localhost') {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 8082);
}

export default firebaseConfig;
