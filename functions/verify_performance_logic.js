/**
 * PRUEBA DE UNIDAD: Verificación de Optimización de Rendimiento
 * Valida que la lógica de db.getAll() es correcta y mantiene la integridad de los datos.
 */

const { logger } = require('firebase-functions');

// Mock de DocumentSnapshot
class MockSnapshot {
    constructor(id, path, data) {
        this.id = id;
        this.ref = { path: path };
        this._data = data;
        this.exists = data !== null;
    }
    data() { return this._data; }
}

// Mock de Firestore
const mockDb = {
    collection: (name) => ({
        where: () => ({
            get: async () => ({
                empty: false,
                size: 2,
                docs: [
                    { id: 'guide1', data: () => ({ nombre: 'Guía 1' }) },
                    { id: 'guide2', data: () => ({ nombre: 'Guía 2' }) }
                ]
            })
        }),
        doc: (id) => ({
            collection: (subname) => ({
                doc: (subid) => ({
                    ref: { path: `${name}/${id}/${subname}/${subid}` }
                })
            })
        })
    }),
    getAll: async (...refs) => {
        // Simulamos que el guía 1 tiene un tour asignado en T1
        return refs.map(ref => {
            const path = ref.ref.path;
            const isGuide1T1 = path.includes('guide1') && path.includes('T1');
            const isGuide2T2 = path.includes('guide2') && path.includes('T2');

            if (isGuide1T1) {
                return new MockSnapshot('T1', path, { estado: 'ASIGNADO' });
            }
            if (isGuide2T2) {
                return new MockSnapshot('T2', path, { estado: 'NO_DISPONIBLE' });
            }
            return new MockSnapshot('other', path, { estado: 'LIBRE' });
        });
    }
};

// Funciones a testear (copiadas tal cual para validación lógica)
async function slotTieneTour(db, fecha, slot) {
    const guides = await db.collection("guides").where("estado", "==", "activo").get();
    if (guides.empty) return false;
    const shiftRefs = guides.docs.map(doc =>
        db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${slot}`)
    );
    const shiftSnaps = await db.getAll(...shiftRefs);
    for (const shift of shiftSnaps) {
        if (shift.exists && shift.data().estado === "ASIGNADO") return true;
    }
    return false;
}

async function calcularDisponibilidadTarde(db, fecha) {
    const TARDE_SLOTS = ["T1", "T2"];
    const snapshot = await db.collection("guides").where("estado", "==", "activo").get();
    if (snapshot.empty) return { guidesDisponiblesTarde: 0 };

    const shiftRefs = [];
    snapshot.docs.forEach(doc => {
        TARDE_SLOTS.forEach(s => {
            shiftRefs.push(db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${s}`));
        });
    });

    const shiftSnaps = await db.getAll(...shiftRefs);
    const shiftsByGuide = {};
    shiftSnaps.forEach(snap => {
        const pathParts = snap.ref.path.split('/');
        const guideId = pathParts[1];
        if (!shiftsByGuide[guideId]) shiftsByGuide[guideId] = [];
        shiftsByGuide[guideId].push(snap);
    });

    let blocked = 0;
    for (const guideId in shiftsByGuide) {
        const isActuallyBlocked = shiftsByGuide[guideId].some(snap =>
            snap.exists && (snap.data().estado === "NO_DISPONIBLE" || snap.data().estado === "ASIGNADO")
        );
        if (isActuallyBlocked) blocked++;
    }
    return { guidesDisponiblesTarde: snapshot.size - blocked };
}

async function runTest() {
    console.log('--- TEST DE OPTIMIZACIÓN FIRESTORE ---\n');

    // Test 1: Detectar tour
    const tieneTour = await slotTieneTour(mockDb, '2026-01-01', 'T1');
    console.log(`Test slotTieneTour (T1): ${tieneTour ? '✅ Detectado' : '❌ Fallo'}`);

    const noTieneTour = await slotTieneTour(mockDb, '2026-01-01', 'T2');
    console.log(`Test slotTieneTour (T2): ${!noTieneTour ? '✅ No Detectado' : '❌ Fallo'}`);

    // Test 2: Disponibilidad Tarde
    // Guia 1 bloqueado en T1 (ASIGNADO), Guia 2 bloqueado en T2 (NO_DISPONIBLE)
    // Ambos deberían contar como bloqueados -> disponibilidad 0
    const disp = await calcularDisponibilidadTarde(mockDb, '2026-01-01');
    console.log(`Test disponibilidadTarde: ${disp.guidesDisponiblesTarde === 0 ? '✅ 0 disponibles' : '❌ Error: ' + disp.guidesDisponiblesTarde}`);

    console.log('\n--- TEST COMPLETADO ---');
}

runTest().catch(console.error);
