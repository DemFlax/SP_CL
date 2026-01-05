const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');
const fetch = require('node-fetch');

// Secrets
const appsScriptUrl = defineSecret('APPS_SCRIPT_URL');
const appsScriptKey = defineSecret('APPS_SCRIPT_API_KEY');

// Config
const BATCH_SIZE = 40; // Apps Script limit is usually loose but safely under 50

// =========================================
// HELPER: Call Apps Script to check statuses
// =========================================
async function checkEventsInAppsScript(eventIds) {
    const APPS_SCRIPT_URL = appsScriptUrl.value();

    if (!APPS_SCRIPT_URL) {
        throw new Error('APPS_SCRIPT_URL not configured');
    }

    try {
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps Script quirk
            body: JSON.stringify({
                endpoint: 'checkEventsStatus',
                apiKey: appsScriptKey.value(),
                eventIds: JSON.stringify(eventIds)
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Apps Script error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Unknown error from Apps Script');
        }

        return result.results; // { eventId: status, ... }

    } catch (error) {
        logger.error('Error calling Apps Script', { error: error.message });
        throw error;
    }
}

// =========================================
// CORE LOGIC: Sync Cancellations
// =========================================
async function runSyncCancellations() {
    const db = getFirestore();
    const today = new Date().toISOString().split('T')[0];

    logger.info('=== 🔄 Starting Sync Cancellations ===');

    // 1. Get all active guides
    const guidesSnap = await db.collection('guides')
        .where('estado', '==', 'activo')
        .get();

    if (guidesSnap.empty) {
        logger.info('No active guides found');
        return { processed: 0, cancelled: 0 };
    }

    let totalProcessed = 0;
    let totalCancelled = 0;
    const shiftsCheck = []; // { guideId, shiftId, eventId, ref }

    // 2. Collate all future assigned shifts with eventIds
    for (const guideDoc of guidesSnap.docs) {
        const shiftsSnap = await db.collection('guides').doc(guideDoc.id).collection('shifts')
            .where('fecha', '>=', today)
            .where('estado', '==', 'ASIGNADO')
            .get(); // Potential perf issue if too many, but for ~20 guides * ~20 shifts it's fine

        shiftsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.eventId) {
                shiftsCheck.push({
                    guideId: guideDoc.id,
                    shiftId: doc.id,
                    eventId: data.eventId,
                    ref: doc.ref,
                    currentStatus: data.estado
                });
            }
        });
    }

    logger.info(`Found ${shiftsCheck.length} shifts to check`);
    if (shiftsCheck.length === 0) return { processed: 0, cancelled: 0 };

    // 3. Process in batches
    for (let i = 0; i < shiftsCheck.length; i += BATCH_SIZE) {
        const batch = shiftsCheck.slice(i, i + BATCH_SIZE);
        const eventIds = batch.map(item => item.eventId);

        try {
            logger.info(`Checking batch ${i} - ${i + batch.length}`);
            const statuses = await checkEventsInAppsScript(eventIds);

            const dbBatch = db.batch();
            let updatesInBatch = 0;

            for (const item of batch) {
                const remoteStatus = statuses[item.eventId]; // "confirmed", "cancelled", "NOT_FOUND"

                if (remoteStatus === 'cancelled' || remoteStatus === 'NOT_FOUND') {
                    logger.info(`❌ Event Cancelled/Missing found`, {
                        guideId: item.guideId,
                        shiftId: item.shiftId,
                        eventId: item.eventId,
                        remoteStatus
                    });

                    // ACTION: Mark as CANCELADO (or LIBRE?)
                    // User requested "sync cancellations". Usually better to keep history as CANCELADO
                    // rather than deleting assignment, so guide knows it happened.

                    dbBatch.update(item.ref, {
                        estado: 'CANCELADO',
                        cancellationReason: `Sync: Event is ${remoteStatus}`,
                        cancelledAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    updatesInBatch++;
                    totalCancelled++;
                }
            }

            if (updatesInBatch > 0) {
                await dbBatch.commit();
                logger.info(`Committed ${updatesInBatch} cancellations`);
            }

        } catch (err) {
            logger.error('Error processing batch', { error: err.message });
            // Continue to next batch
        }
    }

    logger.info('=== ✅ Sync Complete ===', { totalProcessed: shiftsCheck.length, totalCancelled });
    return { processed: shiftsCheck.length, cancelled: totalCancelled };
}

// =========================================
// EXPORTS
// =========================================

// Scheduled function: Runs every hour
exports.syncCancellationsParams = {
    schedule: '0 * * * *', // Every hour
    timeZone: 'Europe/Madrid',
    secrets: [appsScriptUrl]
};

exports.syncCancellationsJob = async (event) => {
    await runSyncCancellations();
};

// Callable function for manual trigger
exports.manualSyncCancellations = onCall({
    cors: true,
    secrets: [appsScriptUrl, appsScriptKey]
}, async (request) => {
    const { auth } = request;
    if (!auth || auth.token.role !== 'manager') {
        throw new HttpsError('permission-denied', 'Only managers');
    }

    try {
        const result = await runSyncCancellations();
        return { success: true, ...result };
    } catch (error) {
        throw new HttpsError('internal', error.message);
    }
});
