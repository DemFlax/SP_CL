// =========================================
// BOOKEO RATE LIMITING (FIX: "Accepted" + CALLBACK MAKE COMPATIBLE PABLO)
// =========================================
// Flujo completo:
// 1) Firestore (guides/{guideId}/shifts/{shiftId}) -> enqueueBookeoWebhook
// 2) enqueueBookeoWebhook -> encola tarea -> bookeoWebhookWorker
// 3) bookeoWebhookWorker -> Make (BLOQUEAR / DESBLOQUEAR) + email Manager
// 4) Make/Bookeo -> callback HTTP a:
//      - saveBookeoBlockId (Pablo)
//      - o receiveBlockIdFromMake (tú si quieres)
//    con body tipo:
//      Bloqueo:
//        {"blockId":"...","date":"YYYY/MM/DD","startTime":"HH:MM","fecha":"..."}
//      Desbloqueo:
//        {"desbloqueo":"success","date":"YYYY/MM/DD","startTime":"HH:MM","fecha":"...","blockId":"..."}
// 5) Callback actualiza/crea bookeo_blocks/{shiftId}
//      - MAÑANA -> shiftId = YYYY-MM-DD_MAÑANA
//      - TARDE -> shiftId = YYYY-MM-DD_T1 / YYYY-MM-DD_T2 (T3 se mapea a T2)
// =========================================

const { onTaskDispatched } = require("firebase-functions/v2/tasks");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getFunctions } = require("firebase-admin/functions");
const { defineSecret } = require("firebase-functions/params");
const axios = require("axios");
const crypto = require("crypto");

// =========================================
// CONFIGURACIÓN
// =========================================
const brevoKey = defineSecret("BREVO_API_KEY");
const appsScriptKey = defineSecret("APPS_SCRIPT_API_KEY");

// URL Webhook Make
const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/5rnftpqpqymx3o5i3g99c4ql4h6w3vv1";

const MANAGER_EMAIL =
  process.env.MANAGER_EMAIL || "leadtoshopsl@gmail.com";
const FROM_EMAIL = "leadtoshopsl@gmail.com";
const FROM_NAME = "demCalendar";
const APP_URL =
  process.env.APP_URL || "https://demcalendar-a9010.web.app";

// Horarios fijos (para Bookeo)
const SLOT_TIMES = {
  MAÑANA: "12:00",
  T1: "17:15",
  T2: "18:15",
  T3: "19:15",
};

const DEBOUNCE_SECONDS = 30;
const MAX_CONCURRENT_REQUESTS = 6;
const MAX_REQUESTS_PER_SECOND = 1.5;
const TARDE_SLOTS = ["T1", "T2", "T3"];
const CANONICAL_TARDE_SLOT = process.env.BOOKEO_SINGLE_TARDE_SLOT === "T1" ? "T1" : "T2";
const BOOKEO_TARDE_SLOTS = [CANONICAL_TARDE_SLOT];
const AFTERNOON_PAX_THRESHOLD = 8;
const QUEUE_TTL_SECONDS = 600;
const BLOCKED_STATUSES = new Set([
  "BLOCKED",
  "BLOCKED_PENDING_ID",
  "BLOCKED_EXTERNAL",
  "BLOCKED_EXTERNAL_PENDING_ID",
]);
const UNBLOCKING_STATUSES = new Set(["UNBLOCK_PENDING_CONFIRM"]);

// =========================================
// WORKER FUNCTION
// =========================================
exports.bookeoWebhookWorker = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 3600,
      maxDoublings: 3,
    },
    rateLimits: {
      maxConcurrentDispatches: MAX_CONCURRENT_REQUESTS,
      maxDispatchesPerSecond: MAX_REQUESTS_PER_SECOND,
    },
    memory: "512MB",
    timeoutSeconds: 180,
    region: "us-central1",
    secrets: [brevoKey],
  },
  async (req) => {
    const { action, payload, shiftId, emailData, requestId } = req.data;

    logger.info("Procesando webhook Make", { action, shiftId, payload });

    const db = getFirestore();

    try {
      if (shiftId) {
        const queueRef = db.collection("bookeo_blocks").doc(shiftId);
        const queueSnap = await queueRef.get();
        const queueData = queueSnap.exists ? queueSnap.data() : null;
        const queueState = getQueueState(queueData);
        if (queueState.active && queueData && queueData.queuedAction) {
          if (!requestId) {
            logger.info("Skipping task without requestId (queue active)", {
              shiftId,
              action,
            });
            return {
              success: true,
              skipped: true,
              reason: "queue_active_no_request_id",
            };
          }
          if (queueData.queuedAction !== action) {
            logger.info("Skipping task (queue action mismatch)", {
              shiftId,
              action,
              queuedAction: queueData.queuedAction,
            });
            return {
              success: true,
              skipped: true,
              reason: "queue_action_mismatch",
            };
          }
          if (
            queueData.queuedRequestId &&
            queueData.queuedRequestId !== requestId
          ) {
            logger.info("Skipping task (queue request mismatch)", {
              shiftId,
              action,
              requestId,
            });
            return {
              success: true,
              skipped: true,
              reason: "queue_request_mismatch",
            };
          }
        }
      }

      if (action === "BLOQUEAR") {
        let evalResult;
        try {
          evalResult = await evaluateBlockRequest(db, shiftId);
        } catch (evalError) {
          logger.error("Error revalidating block request", {
            shiftId,
            error: evalError.message,
          });
          return { success: true, skipped: true, reason: "revalidation_failed" };
        }

        if (!evalResult.shouldBlock) {
          logger.info("Skipping stale block request", {
            shiftId,
            reason: evalResult.reason,
          });
          await clearQueueForRequest(db, shiftId, requestId);
          return { success: true, skipped: true, reason: evalResult.reason };
        }

        if (evalResult.isAlreadyBlocked) {
          logger.info("Skipping block request (already blocked)", {
            shiftId,
            reason: evalResult.reason,
          });
          await clearQueueForRequest(db, shiftId, requestId);
          return { success: true, skipped: true, reason: "already_blocked" };
        }
      }

      if (action === "DESBLOQUEAR") {
        let evalResult;
        try {
          evalResult = await evaluateBlockRequest(db, shiftId);
        } catch (evalError) {
          logger.error("Error revalidating unblock request", {
            shiftId,
            error: evalError.message,
          });
          return { success: true, skipped: true, reason: "revalidation_failed" };
        }

        if (!evalResult || evalResult.reason === "invalid_shift") {
          await clearQueueForRequest(db, shiftId, requestId);
          return { success: true, skipped: true, reason: "invalid_shift" };
        }

        if (evalResult.shouldBlock) {
          logger.info("Skipping stale unblock request", {
            shiftId,
            reason: evalResult.reason,
          });
          await clearQueueForRequest(db, shiftId, requestId);
          return { success: true, skipped: true, reason: "should_block" };
        }
      }

      let emailStatus = emailData ? "pending" : "not_requested";

      // 1. Llamada a Make
      const response = await axios.post(MAKE_WEBHOOK_URL, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      });

      const responseData = response.data || {};
      logger.info(`Respuesta Make [${action}]`, {
        status: response.status,
        data: responseData,
      });

      // 2. Email (si aplica)
      if (emailData) {
        try {
          const apiKey = brevoKey.value();
          await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: FROM_NAME, email: FROM_EMAIL },
            to: [{ email: MANAGER_EMAIL }],
            subject: emailData.subject,
            htmlContent: emailData.html
          }, {
            headers: {
              'api-key': apiKey,
              'Content-Type': 'application/json'
            }
          });
          emailStatus = "sent";
        } catch (emailError) {
          emailStatus = "failed";
          logger.error("Error enviando email de Bookeo (Brevo)", emailError.response?.data || emailError.message);
        }
      }

      // 3. Procesar respuesta
      if (action === "BLOQUEAR") {
        // Intentar leer ID explícito
        let blockId =
          responseData.blockId || responseData.id || responseData.bookeoId;

        // Filtrar respuestas genéricas tipo "Accepted"/"OK"/"success"
        if (!blockId && typeof responseData === "string" && responseData.length > 1) {
          const text = responseData.trim();
          if (
            text !== "Accepted" &&
            text !== "OK" &&
            !text.toLowerCase().includes("success")
          ) {
            blockId = text;
          } else {
            logger.warn(`Ignorando respuesta genérica "${text}" como ID`, {
              shiftId,
            });
          }
        }

        const [fecha, slot] = shiftId.split("_");

        if (blockId) {
          // ID válido recibido
          await db.collection("bookeo_blocks").doc(shiftId).set({
            fecha,
            slot,
            bookeoId: blockId,
            status: "BLOCKED",
            createdAt: FieldValue.serverTimestamp(),
            webhookResponse: responseData,
            warning: FieldValue.delete(),
            ...queueClearData(),
          }, { merge: true });
          logger.info("✅ Bloqueo OK - ID guardado", { shiftId, blockId });
        } else {
          // Respuesta recibida pero SIN ID (ej: "Accepted")
          logger.info(
            "⏳ Bloqueo iniciado, esperando ID (Callback)...",
            { shiftId }
          );

          await db
            .collection("bookeo_blocks")
            .doc(shiftId)
            .set(
              {
                fecha,
                slot,
                bookeoId: null,
                status: "BLOCKED_PENDING_ID",
                warning:
                  "Response was generic (e.g. Accepted). Waiting for Callback.",
                createdAt: FieldValue.serverTimestamp(),
                webhookResponse: responseData,
                ...queueClearData(),
              },
              { merge: true }
            );
        }
      } else if (action === "DESBLOQUEAR") {
        const updateData = {
          status: "UNBLOCK_PENDING_CONFIRM",
          unblockRequestedAt: FieldValue.serverTimestamp(),
          webhookResponse: responseData,
          ...queueClearData(),
        };

        await db
          .collection("bookeo_blocks")
          .doc(shiftId)
          .update(updateData);
        logger.info("✅ Desbloqueo solicitado (pendiente de confirmación)", {
          shiftId,
        });
      }

      // Log auditoría
      await db.collection("webhookLogs").add({
        shiftId,
        action,
        payload,
        responseStatus: response.status,
        responseData,
        emailStatus,
        timestamp: FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (error) {
      logger.error(`Error Webhook ${action}`, error);
      throw error;
    }
  }
);

// =========================================
// CALLBACK MAKE (PABLO) – COMPATIBLE CON SU JSON
// =========================================

/**
 * Mapea startTime (string) al slot interno.
 * MAÑANA -> "MAÑANA"
 * TARDE  -> "T1" o "T2" (T3 se mapea a "T2")
 */
function mapStartTimeToSlot(startTime) {
  if (!startTime) return null;
  const t = String(startTime).trim();

  if (t === SLOT_TIMES["MAÑANA"]) return "MAÑANA";

  // Tarde: todo se mapea al slot canónico configurado
  if (t === SLOT_TIMES["T1"]) return CANONICAL_TARDE_SLOT;
  if (t === SLOT_TIMES["T2"] || t === SLOT_TIMES["T3"]) return CANONICAL_TARDE_SLOT;

  return null;
}

function getAlternateTardeSlot(slot) {
  if (BOOKEO_TARDE_SLOTS.length < 2) return null;
  if (slot === "T1") return "T2";
  if (slot === "T2") return "T1";
  if (slot === "T3") return "T2";
  return null;
}

/**
 * Resuelve shiftId a partir del body:
 *  - Si viene shiftId: normaliza la fecha (YYYY/MM/DD -> YYYY-MM-DD).
 *  - Si NO viene shiftId: usa date + startTime para construirlo.
 */
function resolveShiftIdFromBody(body) {
  let { shiftId, date, startTime } = body || {};

  if (shiftId && typeof shiftId === "string") {
    const [rawDate, rawSlot] = shiftId.split("_");
    if (!rawSlot) return null;
    const normDate = rawDate.replace(/\//g, "-");
    return `${normDate}_${rawSlot}`;
  }

  if (!date || !startTime) return null;

  const normDate = String(date)
    .trim()
    .replace(/\./g, "-")
    .replace(/\//g, "-");

  const slot = mapStartTimeToSlot(startTime);
  if (!slot) return null;

  return `${normDate}_${slot}`;
}

/**
 * Handler común para callbacks de Make/Bookeo.
 */
async function handleMakeCallback(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, reason: "Método no permitido" });
  }

  const body = req.body || {};
  logger.info("Callback Make recibido", { body });

  // Callbacks realmente vacíos → se ignoran pero responden 200
  const hasShiftId = !!body.shiftId;
  const hasDate = !!body.date;
  const hasStartTime = !!body.startTime;

  if (!hasShiftId && !hasDate && !hasStartTime) {
    logger.warn(
      "Callback Make vacío sin shiftId/date/startTime. Se ignora pero se responde 200.",
      { body }
    );
    return res.status(200).json({
      success: true,
      ignored: true,
      reason: "Empty callback without shiftId/date/startTime",
    });
  }

  const db = getFirestore();

  try {
    const shiftId = resolveShiftIdFromBody(body);
    if (!shiftId) {
      logger.error(
        "Callback Make: no se pudo resolver shiftId (faltan date/startTime o formato desconocido)",
        { body }
      );
      return res.status(400).json({
        success: false,
        reason:
          "No se pudo resolver shiftId (faltan date/startTime o formato desconocido)",
      });
    }

    const { blockId, fecha, desbloqueo, date, startTime } = body;
    const isDesbloqueo = String(desbloqueo || "").toLowerCase() === "success";

    const ref = db.collection("bookeo_blocks").doc(shiftId);
    const snap = await ref.get();
    const existed = snap.exists;
    const prev = existed ? snap.data() : {};

    const updateData = {
      lastCallbackAt: FieldValue.serverTimestamp(),
      rawCallback: body,
    };

    if (date) updateData.dateFromVendor = date;
    if (startTime) updateData.startTimeFromVendor = startTime;

    if (isDesbloqueo) {
      // DESBLOQUEO CONFIRMADO
      updateData.status = existed ? "UNBLOCKED" : "UNBLOCKED_EXTERNAL";
      if (fecha) {
        updateData.unlockedAt = fecha;
      } else {
        updateData.unlockedAt = FieldValue.serverTimestamp();
      }
    } else {
      // BLOQUEO / CONFIRMACIÓN BLOQUEO
      if (blockId) {
        updateData.bookeoId = blockId;
        if (fecha) {
          updateData.lockedAt = fecha;
        }
        if (existed) {
          // Teníamos ya un doc (p.ej. creado por nuestro worker)
          updateData.status = "BLOCKED";
          if (prev && prev.warning) {
            updateData.warning = FieldValue.delete();
          }
        } else {
          // No existía doc -> bloqueo externo o prueba
          updateData.status = "BLOCKED_EXTERNAL";
        }
      } else {
        // Sin blockId nuevo
        if (existed) {
          updateData.status = prev.status || "BLOCKED_PENDING_ID";
        } else {
          updateData.status = "BLOCKED_EXTERNAL_PENDING_ID";
        }
      }
    }

    await ref.set(updateData, { merge: true });

    // Auto-desbloqueo si el bloqueo llega tarde y ya hay guías libres
    if (!isDesbloqueo && blockId && existed) {
      const prevStatus = prev && prev.status ? String(prev.status) : "";
      const isExternal = prevStatus.startsWith("BLOCKED_EXTERNAL");

      if (!isExternal) {
        const [fechaRaw, slot] = shiftId.split("_");
        let debeDesbloquear = false;
        let hasAvailableGuides = false;

        if (slot === "MAÑANA") {
          const resultado = await calcularDisponibilidadSlot(
            db,
            fechaRaw,
            "MAÑANA"
          );
          debeDesbloquear = resultado.debeDesbloquear;
          hasAvailableGuides = resultado.availableCount > 0;
        } else if (BOOKEO_TARDE_SLOTS.includes(slot)) {
          const resultadoTarde = await calcularDisponibilidadTarde(
            db,
            fechaRaw
          );
          debeDesbloquear = resultadoTarde.debeDesbloquear;
          hasAvailableGuides = resultadoTarde.guidesDisponiblesTarde > 0;
        }

        if (debeDesbloquear) {
          logger.info("Auto-DESBLOQUEAR desde callback (bloqueo tardío)", {
            shiftId,
            blockId,
          });

          const dateForMake = fechaRaw.replace(/-/g, "/");
          await processSlotBlocking(
            db,
            fechaRaw,
            slot,
            dateForMake,
            false,
            { hasAvailableGuides }
          );
        }
      }
    }

    logger.info("Callback Make procesado correctamente", {
      shiftId,
      status: updateData.status,
    });

    return res.json({
      success: true,
      status: updateData.status,
      shiftId,
    });
  } catch (e) {
    logger.error("Error callback Make", e);
    return res.status(500).json({ success: false, error: e.message });
  }

}

// Endpoint oficial que usa Pablo (URL fija en Make/Postman)
exports.saveBookeoBlockId = onRequest(
  { cors: true, region: "us-central1" },
  handleMakeCallback
);

// Endpoint alternativo (por si quieres otra URL en el futuro)
exports.receiveBlockIdFromMake = onRequest(
  { cors: true, region: "us-central1" },
  handleMakeCallback
);

// =========================================
// CALENDAR PAX UPDATE -> BLOQUEO NUEVA TARDE
// =========================================
exports.handleCalendarPaxUpdate = onRequest(
  { cors: true, region: "us-central1", secrets: [appsScriptKey] },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, reason: "method_not_allowed" });
    }

    const body = req.body || {};
    const apiKey = String(body.apiKey || req.get("x-api-key") || "");
    if (!apiKey || apiKey !== appsScriptKey.value()) {
      return res.status(401).json({ success: false, reason: "invalid_api_key" });
    }

    const eventId = body.eventId;
    const totalPax = Number(body.totalPax ?? body.pax);

    if (!eventId || !Number.isFinite(totalPax)) {
      return res.status(400).json({ success: false, reason: "missing_event_or_pax" });
    }

    if (totalPax <= AFTERNOON_PAX_THRESHOLD) {
      return res.json({ success: true, ignored: true, reason: "pax_below_threshold" });
    }

    const db = getFirestore();

    try {
      const assignedSnap = await db
        .collectionGroup("shifts")
        .where("eventId", "==", eventId)
        .get();

      const assignedDocs = assignedSnap.docs.filter(
        doc => doc.data().estado === "ASIGNADO"
      );

      if (assignedDocs.length === 0) {
        return res.json({ success: true, ignored: true, reason: "not_assigned" });
      }

      if (assignedDocs.length > 1) {
        logger.warn("Multiple assigned shifts for eventId", { eventId, count: assignedDocs.length });
      }

      const assignedData = assignedDocs[0].data();
      const fechaRaw = assignedData.fecha;
      const assignedSlot = assignedData.slot;

      if (!fechaRaw || !assignedSlot || !TARDE_SLOTS.includes(assignedSlot)) {
        return res.json({ success: true, ignored: true, reason: "not_tarde" });
      }

      const targetSlot = getAlternateTardeSlot(assignedSlot);
      if (!targetSlot) {
        return res.json({ success: true, ignored: true, reason: "no_target_slot" });
      }

      const disponibilidad = await calcularDisponibilidadTarde(db, fechaRaw);
      if (disponibilidad.guidesDisponiblesTarde > 0) {
        return res.json({ success: true, ignored: true, reason: "guide_available" });
      }

      const targetAssigned = await slotTieneAsignado(db, fechaRaw, targetSlot);
      if (targetAssigned) {
        return res.json({ success: true, ignored: true, reason: "target_slot_assigned" });
      }

      const targetShiftId = `${fechaRaw}_${targetSlot}`;
      await db.collection("bookeo_blocks").doc(targetShiftId).set({
        paxBlocked: true,
        paxBlockedAt: FieldValue.serverTimestamp(),
        paxSource: {
          eventId,
          totalPax,
          assignedSlot: assignedSlot,
        },
      }, { merge: true });

      const dateForMake = fechaRaw.replace(/-/g, "/");
      await processSlotBlocking(
        db,
        fechaRaw,
        targetSlot,
        dateForMake,
        true,
        { hasAvailableGuides: false }
      );

      return res.json({
        success: true,
        blocked: true,
        fecha: fechaRaw,
        targetSlot: targetSlot,
      });
    } catch (error) {
      logger.error("Error handleCalendarPaxUpdate", { error: error.message, eventId });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// =========================================
// TRIGGER (Monitor de Cambios)
// =========================================
exports.enqueueBookeoWebhook = onDocumentUpdated(
  {
    document: "guides/{guideId}/shifts/{shiftId}",
    region: "us-central1",
    secrets: [brevoKey],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const shiftId = event.params.shiftId;
    const guideId = event.params.guideId;
    const [fechaRaw] = shiftId.split("_");
    const slot = after.slot;

    if (before.estado === after.estado) return;

    const db = getFirestore();

    try {
      if (
        TARDE_SLOTS.includes(slot) &&
        (after.estado === "LIBRE" || after.estado === "NO_DISPONIBLE")
      ) {
        const fecha = after.fecha || fechaRaw;
        await syncGuideAfternoonAvailability(
          db,
          guideId,
          fecha,
          after.estado,
          slot
        );
      }

      const guidesSnapshot = await db
        .collection("guides")
        .where("estado", "==", "activo")
        .get();
      const totalGuides = guidesSnapshot.size;
      if (totalGuides === 0) return;

      const dateForMake = fechaRaw.replace(/-/g, "/");

      // --- LÓGICA MAÑANA ---
      if (slot === "MAÑANA") {
        const resultado = await calcularDisponibilidadSlot(
          db,
          fechaRaw,
          "MAÑANA"
        );
        const stateHash = calculateStateHash({
          total: totalGuides,
          available: resultado.availableCount,
          assigned: resultado.assignedCount,
          unavailable: resultado.unavailableCount,
        });

        if (
          await checkAndSetState(
            db,
            `${fechaRaw}_MAÑANA_STATE`,
            stateHash,
            resultado
          )
        ) {
          await processSlotBlocking(
            db,
            fechaRaw,
            "MAÑANA",
            dateForMake,
            resultado.debeBloquear,
            { hasAvailableGuides: resultado.availableCount > 0 }
          );
        }
      }

      // --- LÓGICA TARDE (T1 + T2) ---
      else if (TARDE_SLOTS.includes(slot)) {
        const resultado = await calcularDisponibilidadTarde(db, fechaRaw);
        const available = resultado.guidesDisponiblesTarde; // Cantidad de guías libres
        const assigned = resultado.guidesAsignadosTarde;

        // Usamos un hash único para el estado de "disponibilidad tarde"
        const assignedSlotsKey = (resultado.assignedSlots || []).join(",");
        const stateHash = calculateStateHash({
          total: totalGuides,
          available: available,
          assigned: assigned,
          assignedSlots: assignedSlotsKey,
        });

        // Verificamos si CAMBIÓ la situación general de la tarde
        if (
          await checkAndSetState(
            db,
            `${fechaRaw}_TARDE_STATE`,
            stateHash,
            resultado
          )
        ) {
          const assignedSlots = resultado.assignedSlots || [];
          const isSingleBookeoSlot = BOOKEO_TARDE_SLOTS.length === 1;
          // If T3 is assigned and no extra guides, keep T1/T2 blocked (multi-slot only).
          const blockDueToT3 =
            !isSingleBookeoSlot && assignedSlots.includes("T3") && available === 0;
          const shouldBlockTarde = resultado.debeBloquear;
          for (const slotName of BOOKEO_TARDE_SLOTS) {
            const isSlotAssigned = assignedSlots.includes(slotName);
            const shouldBlockSlot =
              !isSlotAssigned && (shouldBlockTarde || blockDueToT3);
            await processSlotBlocking(
              db,
              fechaRaw,
              slotName,
              dateForMake,
              shouldBlockSlot,
              { hasAvailableGuides: available > 0 }
            );
          }
        }
      }
    } catch (error) {
      logger.error("Error Trigger enqueueBookeoWebhook", error);
    }
  }
);


async function processSlotBlocking(
  db,
  fechaRaw,
  slotName,
  dateForMake,
  shouldBlock,
  options = {}
) {
  const shiftId = `${fechaRaw}_${slotName}`;
  const hasAvailableGuides =
    options.hasAvailableGuides !== undefined ? options.hasAvailableGuides : true;

  const transactionResult = await db.runTransaction(async (t) => {
    const ref = db.collection("bookeo_blocks").doc(shiftId);
    const snap = await t.get(ref);
    const existingData = snap.exists ? snap.data() : {};
    const queueState = getQueueState(existingData);
    const queuedAction = existingData.queuedAction;

    const isPaxBlocked = existingData.paxBlocked === true;
    const keepPaxBlocked = isPaxBlocked && !hasAvailableGuides;
    const effectiveShouldBlock = shouldBlock || keepPaxBlocked;

    if (queueState.stale && queuedAction) {
      t.set(ref, queueClearData(), { merge: true });
    }

    const hasActiveBlockQueue = queueState.active && queuedAction === "BLOQUEAR";
    const hasActiveUnblockQueue = queueState.active && queuedAction === "DESBLOQUEAR";
    const isBlocked = isEffectivelyBlockedStatus(existingData.status);
    const isBlockedStrict = isBlockedStatus(existingData.status);
    const realBookeoId = existingData.bookeoId;

    let enqueueAction = null;
    let enqueueRequestId = null;
    let unblockSkipped = false;

    if (effectiveShouldBlock) {
      if (hasActiveUnblockQueue) {
        t.set(ref, queueClearData(), { merge: true });
      }
      if (!hasActiveBlockQueue && !isBlocked) {
        enqueueRequestId = crypto.randomBytes(8).toString("hex");
        t.set(
          ref,
          {
            queuedAction: "BLOQUEAR",
            queuedAt: FieldValue.serverTimestamp(),
            queuedRequestId: enqueueRequestId,
          },
          { merge: true }
        );
        enqueueAction = "BLOQUEAR";
      }
    } else {
      if (hasActiveBlockQueue) {
        t.set(ref, queueClearData(), { merge: true });
      }
      if (!hasActiveUnblockQueue && isBlockedStrict) {
        if (realBookeoId && realBookeoId !== "Accepted") {
          enqueueRequestId = crypto.randomBytes(8).toString("hex");
          t.set(
            ref,
            {
              queuedAction: "DESBLOQUEAR",
              queuedAt: FieldValue.serverTimestamp(),
              queuedRequestId: enqueueRequestId,
            },
            { merge: true }
          );
          enqueueAction = "DESBLOQUEAR";
        } else {
          unblockSkipped = true;
        }
      }
    }

    if (isPaxBlocked && hasAvailableGuides) {
      t.set(ref, {
        paxBlocked: FieldValue.delete(),
        paxBlockedAt: FieldValue.delete(),
        paxSource: FieldValue.delete(),
      }, { merge: true });
    }

    return {
      enqueueAction,
      enqueueRequestId,
      realBookeoId,
      unblockSkipped,
    };
  });

  if (transactionResult.enqueueAction === "BLOQUEAR") {
    const enqueued = await enqueueWebhook({
      action: "BLOQUEAR",
      shiftId: shiftId,
      payload: {
        date: dateForMake,
        startTime: SLOT_TIMES[slotName],
        accion: "bloquear",
        shiftId: shiftId,
      },
      emailData: {
        subject: `🚫 Bloqueo: ${fechaRaw} ${slotName}`,
        html: generarEmail(fechaRaw, slotName),
      },
      requestId: transactionResult.enqueueRequestId,
    });
    if (!enqueued) {
      await clearQueueForRequest(db, shiftId, transactionResult.enqueueRequestId);
    }
  } else if (transactionResult.enqueueAction === "DESBLOQUEAR") {
    if (transactionResult.realBookeoId && transactionResult.realBookeoId !== "Accepted") {
      const enqueued = await enqueueWebhook({
        action: "DESBLOQUEAR",
        shiftId: shiftId,
        payload: {
          accion: "desbloquear",
          blockId: transactionResult.realBookeoId,
          shiftId: shiftId,
        },
        emailData: null,
        requestId: transactionResult.enqueueRequestId,
      });
      if (!enqueued) {
        await clearQueueForRequest(db, shiftId, transactionResult.enqueueRequestId);
        return;
      }
      await db
        .collection("bookeo_blocks")
        .doc(`${fechaRaw}_${slotName}_EMAIL_STATE`)
        .delete()
        .catch(() => { });
    }
  } else if (transactionResult.unblockSkipped) {
    logger.error(
      `⚠️ No se puede desbloquear ${slotName}: ID inválido o pendiente`,
      { fecha: fechaRaw, id: transactionResult.realBookeoId }
    );
  }
}

async function evaluateBlockRequest(db, shiftId) {
  const [fechaRaw, slotName] = String(shiftId || "").split("_");
  if (!fechaRaw || !slotName) {
    return { shouldBlock: false, isAlreadyBlocked: false, reason: "invalid_shift" };
  }

  const blockDoc = await db.collection("bookeo_blocks").doc(shiftId).get();
  const existingData = blockDoc.exists ? blockDoc.data() : {};
  const isAlreadyBlocked = isEffectivelyBlockedStatus(existingData.status);

  if (slotName === "MAÃANA") {
    const resultado = await calcularDisponibilidadSlot(db, fechaRaw, "MAÃANA");
    return {
      shouldBlock: resultado.debeBloquear === true,
      isAlreadyBlocked,
      reason: resultado.debeBloquear ? "no_guides" : "guides_available_or_assigned",
    };
  }

  if (!BOOKEO_TARDE_SLOTS.includes(slotName)) {
    return { shouldBlock: false, isAlreadyBlocked, reason: "unsupported_slot" };
  }

  const resultadoTarde = await calcularDisponibilidadTarde(db, fechaRaw);
  const available = resultadoTarde.guidesDisponiblesTarde;
  const assignedSlots = resultadoTarde.assignedSlots || [];

  if (assignedSlots.includes(slotName)) {
    return { shouldBlock: false, isAlreadyBlocked, reason: "slot_assigned" };
  }

  const isSingleBookeoSlot = BOOKEO_TARDE_SLOTS.length === 1;
  const blockDueToT3 =
    !isSingleBookeoSlot && assignedSlots.includes("T3") && available === 0;
  const blockDueToNoGuides = resultadoTarde.debeBloquear === true;
  const paxBlocked = existingData.paxBlocked === true;
  const blockDueToPax = paxBlocked && available === 0;
  const shouldBlock = blockDueToNoGuides || blockDueToT3 || blockDueToPax;

  let reason = "guides_available";
  if (blockDueToPax) {
    reason = "pax_blocked";
  } else if (blockDueToT3) {
    reason = "t3_assigned_no_guides";
  } else if (blockDueToNoGuides) {
    reason = "no_guides";
  } else if (available === 0 && assignedSlots.length > 0) {
    reason = "assigned_only";
  }

  return { shouldBlock, isAlreadyBlocked, reason };
}

async function syncGuideAfternoonAvailability(
  db,
  guideId,
  fecha,
  estado,
  currentSlot
) {
  if (!guideId || !fecha) return;
  if (!TARDE_SLOTS.includes(currentSlot)) return;
  if (estado !== "LIBRE" && estado !== "NO_DISPONIBLE") return;

  const otherSlots = TARDE_SLOTS.filter(slot => slot !== currentSlot);
  const refs = otherSlots.map(slot =>
    db.collection("guides").doc(guideId).collection("shifts").doc(`${fecha}_${slot}`)
  );
  const snaps = await db.getAll(...refs);

  const batch = db.batch();
  let hasUpdates = false;

  snaps.forEach(snap => {
    if (!snap.exists) return;
    const data = snap.data();
    if (data.estado === "ASIGNADO") return;
    if (data.estado === estado) return;

    batch.update(snap.ref, {
      estado: estado,
      updatedAt: FieldValue.serverTimestamp(),
    });
    hasUpdates = true;
  });

  if (hasUpdates) {
    await batch.commit();
  }
}

// =========================================
// HELPERS
// =========================================
function isBlockedStatus(status) {
  return BLOCKED_STATUSES.has(String(status || ""));
}

function isUnblockingStatus(status) {
  return UNBLOCKING_STATUSES.has(String(status || ""));
}

function isEffectivelyBlockedStatus(status) {
  return isBlockedStatus(status) || isUnblockingStatus(status);
}

function getQueueState(data) {
  if (!data || !data.queuedAction) {
    return { active: false, stale: false };
  }
  const queuedAt = data.queuedAt && typeof data.queuedAt.toDate === "function"
    ? data.queuedAt.toDate().getTime()
    : null;
  if (!queuedAt) {
    return { active: false, stale: true };
  }
  const ageMs = Date.now() - queuedAt;
  const stale = ageMs > QUEUE_TTL_SECONDS * 1000;
  return { active: !stale, stale, ageMs };
}

function queueClearData() {
  return {
    queuedAction: FieldValue.delete(),
    queuedAt: FieldValue.delete(),
    queuedRequestId: FieldValue.delete(),
  };
}

async function clearQueueForRequest(db, shiftId, requestId) {
  if (!shiftId || !requestId) return;
  const ref = db.collection("bookeo_blocks").doc(shiftId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (data.queuedRequestId && data.queuedRequestId !== requestId) return;
    t.set(ref, queueClearData(), { merge: true });
  });
}

function calculateStateHash(obj) {
  return crypto
    .createHash("md5")
    .update(JSON.stringify(obj))
    .digest("hex");
}

async function checkAndSetState(db, docId, hash, data) {
  return db.runTransaction(async (t) => {
    const ref = db.collection("bookeo_blocks").doc(docId);
    const doc = await t.get(ref);
    if (doc.exists && doc.data().lastHash === hash) return false;
    t.set(ref, {
      lastHash: hash,
      lastProcessed: FieldValue.serverTimestamp(),
      ...data,
    });
    return true;
  });
}

async function checkAndSetEmailState(db, docId, valueToCheck) {
  return db.runTransaction(async (transaction) => {
    const ref = db.collection("bookeo_blocks").doc(docId);
    const doc = await transaction.get(ref);
    if (doc.exists) return false;
    transaction.set(ref, {
      sentAt: FieldValue.serverTimestamp(),
      value: valueToCheck,
    });
    return true;
  });
}

async function slotTieneAsignado(db, fecha, slot) {
  const guides = await db.collection("guides").where("estado", "==", "activo").get();
  if (guides.empty) return false;

  const shiftRefs = guides.docs.map(doc =>
    db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${slot}`)
  );

  const shiftSnaps = await db.getAll(...shiftRefs);
  return shiftSnaps.some(
    snap => snap.exists && snap.data().estado === "ASIGNADO"
  );
}

async function calcularDisponibilidadSlot(db, fecha, slot) {
  const snapshot = await db
    .collection("guides")
    .where("estado", "==", "activo")
    .get();

  if (snapshot.empty) {
    return {
      unavailableCount: 0,
      assignedCount: 0,
      availableCount: 0,
      debeBloquear: false,
      debeDesbloquear: false,
    };
  }

  const shiftRefs = snapshot.docs.map(doc =>
    db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${slot}`)
  );

  const shiftSnaps = await db.getAll(...shiftRefs);
  let unavailableCount = 0;
  let assignedCount = 0;

  for (const shift of shiftSnaps) {
    if (shift.exists) {
      if (shift.data().estado === "ASIGNADO") {
        assignedCount++;
      } else if (shift.data().estado === "NO_DISPONIBLE") {
        unavailableCount++;
      }
    }
  }

  const availableCount =
    snapshot.size - assignedCount - unavailableCount;

  return {
    unavailableCount,
    assignedCount,
    availableCount,
    debeBloquear: availableCount === 0 && assignedCount === 0,
    debeDesbloquear: availableCount > 0 || assignedCount > 0,
  };
}

async function calcularDisponibilidadTarde(db, fecha) {
  const snapshot = await db
    .collection("guides")
    .where("estado", "==", "activo")
    .get();

  if (snapshot.empty) {
    return {
      guidesDisponiblesTarde: 0,
      guidesAsignadosTarde: 0,
      guidesBloqueadosTarde: 0,
      assignedSlots: [],
      debeBloquear: false,
      debeDesbloquear: false,
    };
  }

  const shiftRefs = [];
  snapshot.docs.forEach(doc => {
    TARDE_SLOTS.forEach(s => {
      shiftRefs.push(db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${s}`));
    });
  });

  const shiftSnaps = await db.getAll(...shiftRefs);

  // Agrupamos por guia para verificar si alguno de sus slots esta bloqueado
  const shiftsByGuide = {};
  const assignedSlots = new Set();
  shiftSnaps.forEach(snap => {
    if (snap.exists) {
      const data = snap.data();
      if (data.estado === "ASIGNADO" && TARDE_SLOTS.includes(data.slot)) {
        assignedSlots.add(data.slot);
      }
    }
    // Extraemos guideId de la ruta del documento: guides/{guideId}/shifts/{shiftId}
    const pathParts = snap.ref.path.split('/');
    const guideId = pathParts[1];
    if (!shiftsByGuide[guideId]) shiftsByGuide[guideId] = [];
    shiftsByGuide[guideId].push(snap);
  });

  let blocked = 0;
  let assigned = 0;
  let available = 0;
  for (const guideId in shiftsByGuide) {
    const guideShifts = shiftsByGuide[guideId];
    const hasAssigned = guideShifts.some(
      snap => snap.exists && snap.data().estado === "ASIGNADO"
    );
    const hasBlocked = guideShifts.some(
      snap => snap.exists && snap.data().estado === "NO_DISPONIBLE"
    );
    if (hasAssigned) {
      assigned++;
    } else if (hasBlocked) {
      blocked++;
    } else {
      available++;
    }
  }

  return {
    guidesDisponiblesTarde: available,
    guidesAsignadosTarde: assigned,
    guidesBloqueadosTarde: blocked,
    assignedSlots: Array.from(assignedSlots).sort(),
    debeBloquear: available === 0 && assigned === 0,
    debeDesbloquear: available > 0 || assigned > 0,
  };
}

async function enqueueWebhook({ action, shiftId, payload, emailData, requestId }) {
  try {
    const queue = getFunctions().taskQueue(
      "locations/us-central1/functions/bookeoWebhookWorker"
    );
    await queue.enqueue(
      { action, payload, shiftId, emailData, requestId },
      { scheduleDelaySeconds: DEBOUNCE_SECONDS }
    );
    return true;
  } catch (e) {
    logger.error("Error encolando tarea Bookeo", e);
    return false;
  }
}

function generarEmail(fecha, turno) {
  return `<p>Alerta: No hay guías para ${fecha} (${turno}). Solicitado bloqueo a Make.</p>`;
}

// Healthcheck sencillo
exports.freshStartBookeo = onRequest((req, res) =>
  res.json({ msg: "Ok" })
);
