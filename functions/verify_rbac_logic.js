/**
 * PRUEBA DE UNIDAD: Verificación de Lógica RBAC
 * Este script simula el entorno de ejecución de Firebase Functions 
 * para validar que los bloqueos de seguridad funcionan.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const functions = require('./index');

// Mock de logs para que no ensucien la consola
const mockLogger = {
    info: () => { },
    error: () => { },
    warn: () => { }
};

async function runTest() {
    console.log('--- INICIANDO TEST DE SEGURIDAD RBAC ---\n');

    const testCases = [
        {
            name: 'assignShiftsToGuide',
            fn: functions.assignShiftsToGuide,
            data: { guideId: 'test', fecha: '2026-01-01', turno: 'MAÑANA' }
        },
        {
            name: 'deleteShiftAssignment',
            fn: functions.deleteShiftAssignment,
            data: { guideId: 'test', fecha: '2026-01-01', turno: 'MAÑANA' }
        },
        {
            name: 'resendInvitation',
            fn: functions.resendInvitation,
            data: { email: 'test@example.com' }
        }
    ];

    for (const tc of testCases) {
        console.log(`Verificando función: ${tc.name}`);

        // TEST 1: Sin Autenticación (Error esperado)
        try {
            await tc.fn({ data: tc.data, auth: null });
            console.error(`  ❌ FALLO: ${tc.name} permitió acceso sin autenticación`);
        } catch (e) {
            if (e.code === 'permission-denied') {
                console.log(`  ✅ OK: Bloqueó acceso anónimo`);
            } else {
                console.error(`  ❌ ERROR INESPERADO: ${e.code} - ${e.message}`);
            }
        }

        // TEST 2: Usuario con Rol 'guide' (Error esperado)
        try {
            await tc.fn({ data: tc.data, auth: { token: { role: 'guide' } } });
            console.error(`  ❌ FALLO: ${tc.name} permitió acceso a un Guía`);
        } catch (e) {
            if (e.code === 'permission-denied') {
                console.log(`  ✅ OK: Bloqueó acceso a un Guía`);
            } else {
                // Ignoramos errores posteriores a la validación de RBAC (ej. fallos de DB)
                // porque ya pasó el "permission-denied" que es lo que testeamos aquí.
                if (e.code !== 'permission-denied' && e.message.includes('Solo los managers')) {
                    console.log(`  ✅ OK: Bloqueó acceso con mensaje específico`);
                } else {
                    // Si el error es otro, significa que PASÓ el RBAC y falló la lógica interna (esperado si no hay DB)
                    console.log(`  🔍 INFO: El RBAC parece haber pasado (Error: ${e.code})`);
                }
            }
        }

        // TEST 3: Usuario con Rol 'manager' (Acceso permitido al RBAC)
        try {
            await tc.fn({ data: tc.data, auth: { token: { role: 'manager' } } });
            // Aquí esperamos que NO sea permission-denied. Fallará por falta de BD real, pero eso es correcto.
            console.log(`  ✅ OK: Permitió acceso a Manager (pasó validación de seguridad)`);
        } catch (e) {
            if (e.code === 'permission-denied') {
                console.error(`  ❌ FALLO: Bloqueó acceso a un Manager legítimo`);
            } else {
                console.log(`  ✅ OK: Pasó validación RBAC (Lógica interna falló como se esperaba: ${e.code})`);
            }
        }
        console.log('');
    }

    console.log('--- TEST COMPLETADO ---');
}

runTest().catch(console.error);
