import { auth, db, appsScriptConfig } from './firebase-config.js';
import { initMenu } from './manager-menu.js';

initMenu();
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// Usar configuración centralizada
const APPS_SCRIPT_URL = appsScriptConfig.url;
const API_KEY = appsScriptConfig.apiKey;

let currentUser = null;
let vendorsUnsubscribe = null;
let editingVendorId = null;
let draggedVendor = null;
let currentVendorCosts = [];
let allVendorCosts = [];
let selectedVendorId = null;
let pendingDeactivateVendor = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    loadVendors();
  } else {
    window.location.href = '/login.html';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
});

function loadVendors() {
  const vendorsQuery = query(collection(db, 'vendors'), where('estado', '==', 'activo'));
  if (vendorsUnsubscribe) vendorsUnsubscribe();

  vendorsUnsubscribe = onSnapshot(vendorsQuery, (snapshot) => {
    const vendorsList = document.getElementById('vendors-list');
    vendorsList.innerHTML = '';

    if (snapshot.empty) {
      vendorsList.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-gray-500 dark:text-gray-400">No hay vendors registrados</p><button onclick="showCreateVendorModal()" class="mt-4 bg-emerald-600 text-white px-4 py-2 rounded-lg">Crear primer vendor</button></div>';
      updateVendorCount();
      return;
    }

    const vendors = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => a.orden - b.orden);

    vendors.forEach(vendor => {
      vendorsList.appendChild(createVendorCard(vendor));
    });

    updateVendorCount();
  });
}

function createVendorCard(vendor) {
  const card = document.createElement('div');
  card.className = 'bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-lg hover:shadow-xl transition-all border border-gray-200 dark:border-gray-700';
  card.draggable = true;
  card.dataset.vendorId = vendor.id;

  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragover', handleDragOver);
  card.addEventListener('drop', handleDrop);
  card.addEventListener('dragend', handleDragEnd);

  card.innerHTML = `
    <div class="flex items-start gap-3 mb-3">
      <svg class="w-6 h-6 text-gray-400 cursor-move flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
      </svg>
      <h3 class="font-bold text-lg text-gray-900 dark:text-white flex-1">${vendor.nombre}</h3>
    </div>
    
    <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
      ${vendor.cif ? `<p class="flex items-center gap-2"><span>🆔</span>${vendor.cif}</p>` : ''}
      ${vendor.direccion ? `<p class="flex items-center gap-2"><span>📍</span>${vendor.direccion}</p>` : ''}
      ${vendor.email ? `<p class="flex items-center gap-2"><span>📧</span>${vendor.email}</p>` : ''}
      <p class="text-xs text-gray-500 dark:text-gray-500 mt-2">Orden: ${vendor.orden}</p>
    </div>
    
    <div class="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
      <button onclick="viewVendorCosts('${vendor.id}', '${vendor.nombre.replace(/'/g, "\\'")}', '${vendor.cif || ''}', '${vendor.direccion || ''}', '${vendor.email || ''}')" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 rounded-lg text-emerald-600 dark:text-emerald-400 font-medium transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z"></path>
        </svg>
        <span class="hidden sm:inline">Costes</span>
      </button>
      <button onclick="editVendor('${vendor.id}')" class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400 font-medium transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
        </svg>
        <span class="hidden sm:inline">Editar</span>
      </button>
      <button onclick="deactivateVendor('${vendor.id}', '${vendor.nombre.replace(/'/g, "\\'")}') " class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg text-red-600 dark:text-red-400 font-medium transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
        <span class="hidden sm:inline">Eliminar</span>
      </button>
    </div>
  `;

  return card;
}

// DRAG & DROP
function handleDragStart(e) {
  draggedVendor = this.dataset.vendorId;
  this.style.opacity = '0.4';
}

function handleDragOver(e) {
  if (e.preventDefault) e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) e.stopPropagation();

  const targetVendorId = this.dataset.vendorId;
  if (draggedVendor !== targetVendorId) {
    reorderVendors(draggedVendor, targetVendorId);
  }

  return false;
}

function handleDragEnd() {
  this.style.opacity = '1';
}

async function reorderVendors(draggedId, targetId) {
  try {
    const vendorsSnapshot = await getDocs(query(collection(db, 'vendors'), where('estado', '==', 'activo')));
    const vendors = vendorsSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => a.orden - b.orden);

    const draggedIndex = vendors.findIndex(v => v.id === draggedId);
    const targetIndex = vendors.findIndex(v => v.id === targetId);

    const [removed] = vendors.splice(draggedIndex, 1);
    vendors.splice(targetIndex, 0, removed);

    const batch = writeBatch(db);
    vendors.forEach((vendor, index) => {
      batch.update(doc(db, 'vendors', vendor.id), { orden: index });
    });

    await batch.commit();
  } catch (error) {
    console.error('Error reordering:', error);
    alert('Error al reordenar vendors');
  }
}

// MODAL VENDOR
window.showCreateVendorModal = function () {
  editingVendorId = null;
  document.getElementById('modal-title').textContent = 'Crear Vendor';
  document.getElementById('vendor-form').reset();
  document.getElementById('vendor-modal').classList.remove('hidden');
};

window.closeVendorModal = function () {
  document.getElementById('vendor-modal').classList.add('hidden');
  editingVendorId = null;
};

window.editVendor = async function (vendorId) {
  editingVendorId = vendorId;
  const vendorDoc = await getDocs(query(collection(db, 'vendors'), where('__name__', '==', vendorId)));
  const vendor = vendorDoc.docs[0].data();

  document.getElementById('modal-title').textContent = 'Editar Vendor';
  document.getElementById('nombre').value = vendor.nombre;
  document.getElementById('cif').value = vendor.cif || '';
  document.getElementById('direccion').value = vendor.direccion || '';
  document.getElementById('email').value = vendor.email || '';

  document.getElementById('vendor-modal').classList.remove('hidden');
};

window.deactivateVendor = function (vendorId, nombre) {
  pendingDeactivateVendor = { id: vendorId, nombre };
  document.getElementById('confirm-message').textContent = `¿Desactivar vendor "${nombre}"?`;
  document.getElementById('confirm-modal').classList.remove('hidden');

  document.getElementById('confirm-action-btn').onclick = async () => {
    try {
      await updateDoc(doc(db, 'vendors', pendingDeactivateVendor.id), {
        estado: 'inactivo',
        updatedAt: serverTimestamp()
      });
      showToast('Vendor desactivado correctamente');
      closeConfirmModal();
    } catch (error) {
      console.error('Error:', error);
      showToast('Error al desactivar vendor', 'error');
    }
  };
};

window.closeConfirmModal = function () {
  document.getElementById('confirm-modal').classList.add('hidden');
  pendingDeactivateVendor = null;
};

// FORM SUBMIT
document.getElementById('vendor-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombre = document.getElementById('nombre').value.trim();
  const cif = document.getElementById('cif').value.trim() || null;
  const direccion = document.getElementById('direccion').value.trim() || null;
  const email = document.getElementById('email').value.trim() || null;

  if (!nombre) {
    showToast('Nombre requerido', 'error');
    return;
  }

  try {
    if (editingVendorId) {
      await updateDoc(doc(db, 'vendors', editingVendorId), {
        nombre,
        cif,
        direccion,
        email,
        updatedAt: serverTimestamp()
      });
      showToast('Vendor actualizado correctamente');
    } else {
      const vendorsSnapshot = await getDocs(query(collection(db, 'vendors'), where('estado', '==', 'activo')));
      const maxOrden = vendorsSnapshot.empty ? -1 : Math.max(...vendorsSnapshot.docs.map(doc => doc.data().orden));

      await addDoc(collection(db, 'vendors'), {
        nombre,
        cif,
        direccion,
        email,
        orden: maxOrden + 1,
        estado: 'activo',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showToast('Vendor creado correctamente');
    }

    closeVendorModal();
  } catch (error) {
    console.error('Error:', error);
    showToast('Error al guardar vendor', 'error');
  }
});

// VENDOR COSTS
window.viewVendorCosts = async function (vendorId, nombre, cif, direccion, email) {
  selectedVendorId = vendorId;

  document.getElementById('costs-vendor-name').textContent = nombre;
  document.getElementById('costs-vendor-cif').textContent = cif ? `CIF: ${cif}` : '';
  document.getElementById('costs-vendor-direccion').textContent = direccion ? `📍 ${direccion}` : '';
  document.getElementById('costs-vendor-email').textContent = email ? `📧 ${email}` : '';

  document.getElementById('costs-modal').classList.remove('hidden');
  loadVendorCosts();
};

window.closeCostsModal = function () {
  document.getElementById('costs-modal').classList.add('hidden');
  selectedVendorId = null;
  allVendorCosts = [];
  currentVendorCosts = [];
};

async function loadVendorCosts() {
  document.getElementById('costs-loading').classList.remove('hidden');
  document.getElementById('costs-table-container').classList.add('hidden');
  document.getElementById('costs-cards-container').classList.add('hidden');
  document.getElementById('costs-empty').classList.add('hidden');

  try {
    const vendorName = document.getElementById('costs-vendor-name').textContent;
    const url = `${APPS_SCRIPT_URL}?endpoint=getVendorCosts&apiKey=${API_KEY}&vendorName=${encodeURIComponent(vendorName)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.message);
    }

    allVendorCosts = data.costs || [];
    filterCosts();

  } catch (error) {
    console.error('Error loading costs:', error);
    showToast('Error al cargar costes: ' + error.message, 'error');
    document.getElementById('costs-loading').classList.add('hidden');
    document.getElementById('costs-empty').classList.remove('hidden');
  }
}

window.filterCosts = function () {
  const month = document.getElementById('filter-month').value;
  const year = document.getElementById('filter-year').value;

  currentVendorCosts = allVendorCosts.filter(cost => {
    if (month && !cost.fecha.includes(`-${month}-`)) return false;
    if (year && !cost.fecha.startsWith(year)) return false;
    return true;
  });

  renderCosts();
};

function renderCosts() {
  document.getElementById('costs-loading').classList.add('hidden');

  if (currentVendorCosts.length === 0) {
    document.getElementById('costs-table-container').classList.add('hidden');
    document.getElementById('costs-cards-container').classList.add('hidden');
    document.getElementById('costs-empty').classList.remove('hidden');
    document.getElementById('costs-total').textContent = '0.00 €';
    return;
  }

  document.getElementById('costs-empty').classList.add('hidden');
  document.getElementById('costs-table-container').classList.remove('hidden');
  document.getElementById('costs-cards-container').classList.remove('hidden');

  // Table desktop
  const tbody = document.getElementById('costs-table-body');
  tbody.innerHTML = '';

  currentVendorCosts.forEach(cost => {
    const row = document.createElement('tr');
    row.className = 'hover:bg-gray-50 dark:hover:bg-gray-700/50';
    row.innerHTML = `
      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">${formatDate(cost.fecha)}</td>
      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">${cost.slot}</td>
      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">${cost.guideName}</td>
      <td class="px-4 py-3 text-sm text-gray-900 dark:text-white">${cost.numPax}</td>
      <td class="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">${parseFloat(cost.importe).toFixed(2)} €</td>
      <td class="px-4 py-3 text-sm">
        ${cost.ticketUrl ? `<a href="${cost.ticketUrl}" target="_blank" class="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline">Ver ticket</a>` : '<span class="text-gray-400">Sin ticket</span>'}
      </td>
    `;
    tbody.appendChild(row);
  });

  // Cards mobile
  const cardsContainer = document.getElementById('costs-cards-container');
  cardsContainer.innerHTML = '';

  currentVendorCosts.forEach(cost => {
    const card = document.createElement('div');
    card.className = 'bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-2';
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <div>
          <p class="font-semibold text-gray-900 dark:text-white">${formatDate(cost.fecha)}</p>
          <p class="text-sm text-gray-600 dark:text-gray-400">${cost.slot} • ${cost.guideName}</p>
        </div>
        <span class="text-lg font-bold text-gray-900 dark:text-white">${parseFloat(cost.importe).toFixed(2)} €</span>
      </div>
      <div class="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-600">
        <span class="text-sm text-gray-600 dark:text-gray-400">${cost.numPax} PAX</span>
        ${cost.ticketUrl ? `<a href="${cost.ticketUrl}" target="_blank" class="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 underline">Ver ticket</a>` : '<span class="text-sm text-gray-400">Sin ticket</span>'}
      </div>
    `;
    cardsContainer.appendChild(card);
  });

  // Calculate total
  const total = currentVendorCosts.reduce((sum, cost) => sum + parseFloat(cost.importe || 0), 0);
  document.getElementById('costs-total').textContent = total.toFixed(2) + ' €';
}

window.exportCostsCSV = function () {
  if (currentVendorCosts.length === 0) {
    showToast('No hay datos para exportar', 'error');
    return;
  }

  const vendorName = document.getElementById('costs-vendor-name').textContent;
  const csvRows = [];

  csvRows.push('Fecha,Slot,Guía,PAX,Importe,Ticket URL');

  currentVendorCosts.forEach(cost => {
    csvRows.push([
      cost.fecha,
      cost.slot,
      cost.guideName,
      cost.numPax,
      parseFloat(cost.importe).toFixed(2),
      cost.ticketUrl || ''
    ].join(','));
  });

  const total = currentVendorCosts.reduce((sum, cost) => sum + parseFloat(cost.importe || 0), 0);
  csvRows.push('');
  csvRows.push(`TOTAL,,,,${total.toFixed(2)},`);

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `costes_${vendorName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();

  showToast('CSV exportado correctamente');
};

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function showToast(message, type = 'success') {
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

// Update vendor count
function updateVendorCount() {
  const vendorsList = document.getElementById('vendors-list');
  if (!vendorsList) return;

  const count = vendorsList.children.length;
  const countElement = document.getElementById('vendor-count');
  if (countElement) {
    countElement.textContent = count;
  }
}
