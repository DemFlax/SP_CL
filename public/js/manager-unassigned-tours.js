import { auth, db } from './firebase-config.js';
import { addGuideToCalendarEvent } from './calendar-api.js';
import {
    collection,
    updateDoc,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

const functions = getFunctions(undefined, 'us-central1');

let currentUser = null;
let allGuides = [];
let guideCounts = {};
let allTours = [];

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await init();
    } else {
        window.location.href = '/login.html';
    }
});

async function init() {
    try {
        // Load guides from Firestore
        await loadGuides();

        // Load unassigned tours and guide counts
        await Promise.all([
            loadUnassignedTours(),
            loadGuideCounts()
        ]);
    } catch (error) {
        console.error('Error initializing:', error);
        showToast('Error cargando datos', 'error');
    }
}

async function loadGuides() {
    const guidesQuery = query(collection(db, 'guides'), where('estado', '==', 'activo'));
    const snapshot = await getDocs(guidesQuery);

    allGuides = [];
    snapshot.forEach((docSnap) => {
        const guide = docSnap.data();
        allGuides.push({ id: docSnap.id, ...guide });
    });

    allGuides.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function loadUnassignedTours() {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const getUnassigned = httpsCallable(functions, 'proxyGetUnassignedTours');
    const result = await getUnassigned({ startDate: today, endDate });

    allTours = result.data.tours || [];
    allTours.sort((a, b) => {
        const dateCompare = a.fecha.localeCompare(b.fecha);
        if (dateCompare !== 0) return dateCompare;
        return a.startTime.localeCompare(b.startTime);
    });
}

async function loadGuideCounts() {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const getCounts = httpsCallable(functions, 'proxyGetGuideAssignmentCount');
    const result = await getCounts({ startDate: today, endDate });

    guideCounts = result.data.counts || {};

    // Ensure all guides have a count (even if 0)
    allGuides.forEach(guide => {
        if (!guideCounts[guide.email]) {
            guideCounts[guide.email] = { email: guide.email, name: guide.nombre, count: 0 };
        }
    });

    renderTours();
}

function renderTours() {
    const loadingState = document.getElementById('loading-state');
    const toursContainer = document.getElementById('tours-container');
    const emptyState = document.getElementById('empty-state');
    const totalSpan = document.getElementById('total-unassigned');

    loadingState.classList.add('hidden');

    if (allTours.length === 0) {
        emptyState.classList.remove('hidden');
        toursContainer.classList.add('hidden');
        totalSpan.textContent = '0';
        return;
    }

    emptyState.classList.add('hidden');
    toursContainer.classList.remove('hidden');
    totalSpan.textContent = allTours.length;

    toursContainer.innerHTML = '';

    allTours.forEach(tour => {
        toursContainer.appendChild(createTourCard(tour));
    });
}

function createTourCard(tour) {
    const dateObj = new Date(tour.fecha + 'T12:00:00');
    const dayName = dateObj.toLocaleDateString('es-ES', { weekday: 'long' });
    const day = dateObj.getDate();
    const monthName = dateObj.toLocaleDateString('es-ES', { month: 'long' });
    const year = dateObj.getFullYear();

    const card = document.createElement('div');
    card.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 sm:p-6 border border-gray-200 dark:border-gray-700';

    // Create dropdown options with guide tour count
    const guidesOptions = allGuides.map(guide => {
        const count = guideCounts[guide.email]?.count || 0;
        return `<option value="${guide.id}">${guide.nombre} [${count}]</option>`;
    }).join('');

    card.innerHTML = `
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div class="flex-1">
        <h3 class="font-bold text-lg sm:text-xl text-gray-900 dark:text-white mb-3">${tour.tourName}</h3>
        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span class="font-medium">${dayName.charAt(0).toUpperCase() + dayName.slice(1)}, ${day} de ${monthName} ${year} - ${tour.startTime}</span>
          </div>
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
            </svg>
            <span class="font-medium">${tour.pax} personas</span>
          </div>
        </div>
      </div>
      <div class="flex-shrink-0 w-full sm:w-auto">
        <select 
          onchange="window.assignGuide('${tour.eventId}', '${tour.fecha}', '${tour.slot}', this.value, this)"
          class="w-full px-4 py-3 bg-red-600 dark:bg-red-700 text-white rounded-lg font-semibold text-sm hover:bg-red-700 dark:hover:bg-red-800 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500">
          <option value="">ASIGNAR GUÍA</option>
          ${guidesOptions}
        </select>
      </div>
    </div>
  `;

    return card;
}

window.assignGuide = async function (eventId, fecha, slot, guideId, selectElement) {
    if (!guideId) return;

    selectElement.disabled = true;
    const originalHTML = selectElement.innerHTML;
    selectElement.innerHTML = '<option>Asignando...</option>';

    try {
        // 1. Get guide info
        const guide = allGuides.find(g => g.id === guideId);
        if (!guide) {
            throw new Error('Guía no encontrado');
        }

        // 2. Verify guide availability
        const shiftQuery = query(
            collection(db, 'guides', guideId, 'shifts'),
            where('fecha', '==', fecha),
            where('slot', '==', slot)
        );
        const shiftSnap = await getDocs(shiftQuery);

        if (shiftSnap.empty) {
            throw new Error('El turno no existe para este guía');
        }

        const shiftData = shiftSnap.docs[0].data();

        if (shiftData.estado === 'NO_DISPONIBLE') {
            showToast(`${guide.nombre} no está disponible ese día`, 'error');
            selectElement.disabled = false;
            selectElement.innerHTML = originalHTML;
            selectElement.value = '';
            return;
        }

        if (shiftData.estado === 'ASIGNADO') {
            showToast(`${guide.nombre} ya tiene un tour asignado en ese horario`, 'error');
            selectElement.disabled = false;
            selectElement.innerHTML = originalHTML;
            selectElement.value = '';
            return;
        }

        // 3. Check for conflicts with other guides
        const allGuidesSnapshot = await getDocs(collection(db, 'guides'));
        for (const guideDoc of allGuidesSnapshot.docs) {
            const conflictQuery = query(
                collection(db, 'guides', guideDoc.id, 'shifts'),
                where('fecha', '==', fecha),
                where('slot', '==', slot),
                where('estado', '==', 'ASIGNADO')
            );
            const conflicts = await getDocs(conflictQuery);
            if (!conflicts.empty) {
                const conflictGuide = guideDoc.data();
                showToast(`Este turno ya está asignado a ${conflictGuide.nombre}`, 'error');
                selectElement.disabled = false;
                selectElement.innerHTML = originalHTML;
                selectElement.value = '';
                return;
            }
        }

        // 4. Update Firestore
        const targetShift = shiftSnap.docs[0];
        await updateDoc(targetShift.ref, {
            estado: 'ASIGNADO',
            eventId: eventId,
            updatedAt: serverTimestamp()
        });

        // 5. Add guide to Google Calendar
        try {
            await addGuideToCalendarEvent(eventId, guide.email);
        } catch (calendarError) {
            console.error('Error adding to calendar:', calendarError);
            // Continue anyway - assignment is already in Firestore
        }

        showToast('¡Tour asignado correctamente!', 'success');

        // 6. Reload page after delay
        setTimeout(() => window.location.reload(), 1500);

    } catch (error) {
        console.error('Error assigning tour:', error);
        showToast(`Error: ${error.message}`, 'error');
        selectElement.disabled = false;
        selectElement.innerHTML = originalHTML;
        selectElement.value = '';
    }
};

function showToast(message, type = 'info') {
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
    } else {
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
