import { auth, db } from './firebase-config.js';
import { initMenu } from './manager-menu.js';

initMenu();
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// Auto dark mode detection
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark');
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (e.matches) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
});

let currentUser = null;
let guidesUnsubscribe = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    loadGuides();
  } else {
    window.location.href = '/login.html';
  }
});

function loadGuides() {
  const guidesQuery = query(collection(db, 'guides'), where('estado', '==', 'activo'));
  if (guidesUnsubscribe) guidesUnsubscribe();

  guidesUnsubscribe = onSnapshot(guidesQuery, (snapshot) => {
    const guidesList = document.getElementById('guides-list');
    guidesList.innerHTML = '';

    if (snapshot.empty) {
      guidesList.innerHTML = `
        <div class="col-span-full text-center py-12">
          <svg class="w-16 h-16 text-gray-400 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
          </svg>
          <p class="text-gray-500 dark:text-gray-400 text-sm">No hay guías registrados</p>
          <button onclick="showCreateGuideModal()" class="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            Crear primer guía
          </button>
        </div>
      `;
      updateGuidesCount();
      return;
    }

    snapshot.forEach((docSnap) => {
      const guide = docSnap.data();
      guidesList.appendChild(createGuideCard(docSnap.id, guide));
    });

    updateGuidesCount();
  });
}

function createGuideCard(id, guide) {
  const card = document.createElement('div');
  card.className = 'guide-card bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-lg hover:shadow-xl transition-all border border-gray-200 dark:border-gray-700 flex flex-col gap-4';
  card.innerHTML = `
    <div class="flex items-start gap-3">
      <svg class="w-6 h-6 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A10.97 10.97 0 0112 15c2.5 0 4.847.82 6.879 2.196M15 11a3 3 0 10-6 0 3 3 0 006 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4a9 9 0 100 18 9 9 0 000-18z" />
      </svg>
      <div class="flex-1 min-w-0">
        <h3 class="font-bold text-lg sm:text-xl truncate text-gray-900 dark:text-white mb-2">${guide.nombre}</h3>
        <div class="space-y-1 text-sm text-gray-600 dark:text-gray-400">
          ${guide.email ? `<p class="flex items-center gap-2 truncate"><svg class="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12H8m8 0l-3-3m3 3l-3 3m3-10H8m8 0l-3-3m3 3l-3 3m-5 8h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v11a2 2 0 002 2z"/></svg>${guide.email}</p>` : ''}
          ${guide.dni ? `<p class="flex items-center gap-2"><svg class="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>${guide.dni}</p>` : ''}
          <p class="flex items-center gap-2"><svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h2l1 5h10l1-5h2M5 21h14M10 9V7h4v2"/></svg>${guide.telefono || 'Sin tel?fono'}</p>
          ${guide.cuenta_bancaria ? `<p class="flex items-center gap-2 truncate"><svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H9a2 2 0 00-2 2v2m10 0H7m10 0v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9m10 0H7"/></svg>${guide.cuenta_bancaria}</p>` : ''}
        </div>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row gap-2 border-t border-gray-200 dark:border-gray-700 pt-3">
      <button onclick="window.impersonateGuide('${id}')" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:hover:bg-purple-900/40 rounded-lg text-purple-600 dark:text-purple-400 font-medium transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
        </svg>
        <span class="hidden sm:inline">Ver como</span>
      </button>
      <button onclick="window.editGuide('${id}')" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-50 hover:bg-sky-100 dark:bg-sky-900/20 dark:hover:bg-sky-900/40 rounded-lg text-sky-600 dark:text-sky-400 font-medium transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
        </svg>
        <span class="hidden sm:inline">Editar</span>
      </button>
      <button onclick="window.deleteGuide('${id}')" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg text-red-600 dark:text-red-400 font-medium transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
        <span class="hidden sm:inline">Eliminar</span>
      </button>
    </div>
  `;
  return card;
}

// ✅ NUEVA FUNCIÓN: Impersonar guía
window.impersonateGuide = (guideId) => {
  window.location.href = `/guide.html?impersonate=${guideId}`;
};

window.showCreateGuideModal = () => {
  const modal = document.getElementById('guide-modal');
  const form = document.getElementById('guide-form');

  modal.classList.remove('hidden');
  form.reset();

  document.getElementById('modal-title').textContent = 'Crear Guía';
  document.getElementById('email').disabled = false;
  document.getElementById('dni').disabled = false;
  form.dataset.mode = 'create';
  delete form.dataset.guideId;

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Crear Guía';
};

window.editGuide = async (guideId) => {
  const modal = document.getElementById('guide-modal');
  modal.classList.remove('hidden');

  await new Promise(resolve => setTimeout(resolve, 0));

  try {
    const guideDoc = await getDoc(doc(db, 'guides', guideId));
    if (!guideDoc.exists()) {
      showToast('Guía no encontrado', 'error');
      return;
    }

    const guide = guideDoc.data();
    const form = document.getElementById('guide-form');

    document.getElementById('modal-title').textContent = 'Editar Guía';
    document.getElementById('nombre').value = guide.nombre || '';
    document.getElementById('email').value = guide.email || '';
    document.getElementById('telefono').value = guide.telefono || '';
    document.getElementById('direccion').value = guide.direccion || '';
    document.getElementById('dni').value = guide.dni || '';
    document.getElementById('cuenta_bancaria').value = guide.cuenta_bancaria || '';

    document.getElementById('email').disabled = true;
    document.getElementById('dni').disabled = true;

    form.dataset.mode = 'edit';
    form.dataset.guideId = guideId;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Guardar Cambios';
  } catch (error) {
    console.error('Error loading guide:', error);
    showToast('Error al cargar guía', 'error');
  }
};

window.closeGuideModal = () => {
  document.getElementById('guide-modal').classList.add('hidden');
  document.getElementById('guide-form').reset();
};

document.getElementById('guide-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  try {
    const formData = {
      nombre: document.getElementById('nombre').value.trim(),
      email: document.getElementById('email').value.trim().toLowerCase(),
      telefono: document.getElementById('telefono').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      dni: document.getElementById('dni').value.trim().toUpperCase(),
      cuenta_bancaria: document.getElementById('cuenta_bancaria').value.trim(),
      estado: 'activo',
      updatedAt: serverTimestamp()
    };

    const mode = e.target.dataset.mode;

    if (mode === 'create') {
      const existingQuery = query(collection(db, 'guides'), where('email', '==', formData.email));
      const existingDocs = await getDocs(existingQuery);

      if (!existingDocs.empty) {
        const existingDoc = existingDocs.docs[0];
        const existingGuide = existingDoc.data();

        if (existingGuide.estado === 'activo') {
          showToast('Error: Ya existe un guía con ese email (activo)', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          return;
        } else {
          formData.reactivatedAt = serverTimestamp();
          await updateDoc(doc(db, 'guides', existingDoc.id), formData);
          showToast('Guía reactivado correctamente', 'success');
          window.closeGuideModal();
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          return;
        }
      }

      formData.createdAt = serverTimestamp();
      await addDoc(collection(db, 'guides'), formData);
      showToast('Guía creado correctamente', 'success');

    } else if (mode === 'edit') {
      const guideId = e.target.dataset.guideId;
      await updateDoc(doc(db, 'guides', guideId), formData);
      showToast('Guía actualizado correctamente', 'success');
    }

    window.closeGuideModal();

  } catch (error) {
    console.error('Error saving guide:', error);
    showToast(error.message || 'Error al guardar guía', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

window.deleteGuide = async (guideId) => {
  const guideDoc = await getDoc(doc(db, 'guides', guideId));
  const guideName = guideDoc.exists() ? guideDoc.data().nombre : 'este guía';

  if (confirm(`¿Estás seguro de que quieres eliminar a ${guideName}? Esta acción es irreversible.`)) {
    try {
      showToast('Eliminando guía...', 'loading');
      await deleteDoc(doc(db, 'guides', guideId));
      showToast('Guía eliminado correctamente', 'success');
      loadGuides(); // Recargar la lista
    } catch (error) {
      console.error('Error deleting guide:', error);
      showToast('Error al eliminar el guía: ' + error.message, 'error');
    }
  }
};

function showToast(message, type = 'info') {
  // Eliminar toast anterior si existe
  const existingModal = document.getElementById('toast-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'toast-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn';

  const isSuccess = type === 'success';
  const isError = type === 'error';
  const isLoading = type === 'loading';

  let icon, btnClass, title;

  if (isSuccess) {
    title = 'Éxito';
    icon = `<div class="w-16 h-16 sm:w-20 sm:h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-5">
      <svg class="w-8 h-8 sm:w-10 sm:h-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
      </svg>
    </div>`;
    btnClass = 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 focus:ring-emerald-500';
  } else if (isError) {
    title = 'Error';
    icon = `<div class="w-16 h-16 sm:w-20 sm:h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-5">
      <svg class="w-8 h-8 sm:w-10 sm:h-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </div>`;
    btnClass = 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 focus:ring-red-500';
  } else if (isLoading) {
    title = 'Procesando...';
    icon = `<div class="w-16 h-16 sm:w-20 sm:h-20 bg-blue-50 dark:bg-blue-900/10 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-5">
      <svg class="w-8 h-8 sm:w-10 sm:h-10 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>`;
    // No button for loading
  } else {
    // Info / Warning
    title = 'Info';
    icon = `<div class="w-16 h-16 sm:w-20 sm:h-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-5">
      <svg class="w-8 h-8 sm:w-10 sm:h-10 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    </div>`;
    btnClass = 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 focus:ring-blue-500';
  }

  const buttonHtml = isLoading ? '' : `
    <button onclick="document.getElementById('toast-modal').remove()"
      class="w-full py-3 sm:py-3.5 px-6 rounded-xl sm:rounded-2xl text-white font-bold text-base sm:text-lg shadow-lg hover:shadow-xl transform transition-all active:scale-95 focus:outline-none focus:ring-4 focus:ring-opacity-50 ${btnClass}">
      ENTENDIDO
    </button>
  `;

  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-2xl sm:rounded-3xl shadow-2xl max-w-sm w-full p-6 sm:p-8 text-center border border-gray-100 dark:border-gray-700 transform transition-all scale-100">
      ${icon}
      <h3 class="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white mb-2 tracking-tight">${title}</h3>
      <p class="text-gray-500 dark:text-gray-300 ${isLoading ? 'mb-0' : 'mb-6 sm:mb-8'} text-base sm:text-lg leading-relaxed">${message}</p>
      ${buttonHtml}
    </div>
  `;

  document.body.appendChild(modal);

  if (isSuccess) {
    setTimeout(() => {
      const m = document.getElementById('toast-modal');
      if (m) m.remove();
    }, 2000);
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.href = '/login.html';
  } catch (error) {
    console.error('Error signing out:', error);
  }
});

function updateGuidesCount() {
  const count = document.getElementById('guides-list').children.length;
  const countEl = document.getElementById('guides-count');
  if (countEl) countEl.textContent = count;
}