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
//      - TARDE -> shiftId = YYYY-MM-DD_T2   (TARDE se representa siempre como T2)
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

// URL Webhook Make
const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/5rnftpqpqymx3o5i3g99c4ql4h6w3vv1";

const MANAGER_EMAIL =
  process.env.MANAGER_EMAIL || "madrid@spainfoodsherpas.com";
const FROM_EMAIL = "madrid@spainfoodsherpas.com";
const FROM_NAME = "Spain Food Sherpas";
const APP_URL =
  process.env.APP_URL || "https://calendar-app-tours.web.app";

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
const TARDE_SLOTS = ["T1", "T2"];

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
    const { action, payload, shiftId, emailData } = req.data;

    logger.info("Procesando webhook Make", { action, shiftId, payload });

    const db = getFirestore();

    try {
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
          });
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
              },
              { merge: true }
            );
        }
      } else if (action === "DESBLOQUEAR") {
        const updateData = {
          status: "UNBLOCK_PENDING_CONFIRM",
          unblockRequestedAt: FieldValue.serverTimestamp(),
          webhookResponse: responseData,
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
 * TARDE  -> siempre "T2" (tu doc de bloqueo de tarde es {fecha}_T2)
 */
function mapStartTimeToSlot(startTime) {
  if (!startTime) return null;
  const t = String(startTime).trim();

  if (t === SLOT_TIMES["MAÑANA"]) return "MAÑANA";

  if (t === SLOT_TIMES["T1"]) return "T1";
  // T3 (19:15) lo tratamos como parte del bloque T2 por ahora si llega callback
  if (t === SLOT_TIMES["T2"] || t === SLOT_TIMES["T3"]) return "T2";

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

        if (slot === "MAÑANA") {
          const resultado = await calcularDisponibilidadSlot(
            db,
            fechaRaw,
            "MAÑANA"
          );
          debeDesbloquear = resultado.debeDesbloquear;
        } else if (slot === "T2") {
          const resultadoTarde = await calcularDisponibilidadTarde(
            db,
            fechaRaw
          );
          debeDesbloquear = resultadoTarde.debeDesbloquear;
        }

        if (debeDesbloquear) {
          logger.info("Auto-DESBLOQUEAR desde callback (bloqueo tardío)", {
            shiftId,
            blockId,
          });

          await enqueueWebhook({
            action: "DESBLOQUEAR",
            shiftId,
            payload: {
              accion: "desbloquear",
              blockId,
              shiftId,
            },
            emailData: null,
          });
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
    const [fechaRaw] = shiftId.split("_");
    const slot = after.slot;

    if (before.estado === after.estado) return;

    const db = getFirestore();

    try {
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
          const blockDoc = await db
            .collection("bookeo_blocks")
            .doc(`${fechaRaw}_MAÑANA`)
            .get();
          const existingData = blockDoc.exists ? blockDoc.data() : {};
          const realBookeoId = existingData.bookeoId;
          const isBlocked =
            blockDoc.exists &&
            (existingData.status === "BLOCKED" ||
              existingData.status === "BLOCKED_PENDING_ID");

          if (resultado.debeBloquear && !isBlocked) {
            // FIX: Verificar si existe tour antes de bloquear
            const tieneTourMañana = await slotTieneTour(db, fechaRaw, "MAÑANA");
            if (!tieneTourMañana) {
              await enqueueWebhook({
                action: "BLOQUEAR",
                shiftId: `${fechaRaw}_MAÑANA`,
                payload: {
                  date: dateForMake,
                  startTime: SLOT_TIMES["MAÑANA"],
                  accion: "bloquear",
                  shiftId: `${fechaRaw}_MAÑANA`,
                },
                emailData: {
                  subject: `🚫 Bloqueo: ${fechaRaw} MAÑANA`,
                  html: generarEmail(fechaRaw, "MAÑANA"),
                },
              });
            } else {
              logger.info("⏩ Bloqueo MAÑANA omitido - tour existente", { fecha: fechaRaw });
            }
          } else if (resultado.debeDesbloquear && isBlocked) {
            if (realBookeoId && realBookeoId !== "Accepted") {
              await enqueueWebhook({
                action: "DESBLOQUEAR",
                shiftId: `${fechaRaw}_MAÑANA`,
                payload: {
                  accion: "desbloquear",
                  blockId: realBookeoId,
                  shiftId: `${fechaRaw}_MAÑANA`,
                },
                emailData: null,
              });
              await db
                .collection("bookeo_blocks")
                .doc(`${fechaRaw}_MAÑANA_EMAIL_STATE`)
                .delete()
                .catch(() => { });
            } else {
              logger.error(
                "⚠️ No se puede desbloquear MAÑANA: ID inválido o pendiente",
                { fecha: fechaRaw, id: realBookeoId }
              );
            }
          } else if (resultado.debeBloquear && isBlocked) {
            // FIX: Auto-desbloquear si está bloqueado pero tiene tour existente
            const tieneTourMañana = await slotTieneTour(db, fechaRaw, "MAÑANA");
            if (tieneTourMañana && realBookeoId && realBookeoId !== "Accepted") {
              logger.info("🔓 Auto-desbloqueando MAÑANA - tour existente detectado", { fecha: fechaRaw });
              await enqueueWebhook({
                action: "DESBLOQUEAR",
                shiftId: `${fechaRaw}_MAÑANA`,
                payload: {
                  accion: "desbloquear",
                  blockId: realBookeoId,
                  shiftId: `${fechaRaw}_MAÑANA`,
                },
                emailData: null,
              });
            }
          }
        }
      }

      // --- LÓGICA TARDE (T1 + T2) ---
      else if (TARDE_SLOTS.includes(slot)) {
        const resultado = await calcularDisponibilidadTarde(db, fechaRaw);
        const available = resultado.guidesDisponiblesTarde; // Cantidad de guías libres

        // Usamos un hash único para el estado de "disponibilidad tarde"
        const stateHash = calculateStateHash({
          total: totalGuides,
          available: available,
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
          // Evaluar T2 (18:15) - Se abre si hay al menos 1 guía
          const shouldBlockT2 = available < 1;
          await processSlotBlocking(
            db,
            fechaRaw,
            "T2",
            dateForMake,
            shouldBlockT2
          );

          // Evaluar T1 (17:15) - Se abre si hay al menos 2 guías
          const shouldBlockT1 = available < 2;
          await processSlotBlocking(
            db,
            fechaRaw,
            "T1",
            dateForMake,
            shouldBlockT1
          );
        }
      }
    } catch (error) {
      logger.error("Error Trigger enqueueBookeoWebhook", error);
    }
  }
);

async function processSlotBlocking(db, fechaRaw, slotName, dateForMake, shouldBlock) {
  const shiftId = `${fechaRaw}_${slotName}`;
  const blockDoc = await db.collection("bookeo_blocks").doc(shiftId).get();
  const existingData = blockDoc.exists ? blockDoc.data() : {};
  const realBookeoId = existingData.bookeoId;

  // Estado actual
  const isBlocked =
    blockDoc.exists &&
    (existingData.status === "BLOCKED" ||
      existingData.status === "BLOCKED_PENDING_ID");

  if (shouldBlock && !isBlocked) {
    // FIX: Verificar si existe tour antes de bloquear
    const tieneTour = await slotTieneTour(db, fechaRaw, slotName);
    if (!tieneTour) {
      // BLOQUEAR
      await enqueueWebhook({
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
      });
    } else {
      logger.info(`⏩ Bloqueo ${slotName} omitido - tour existente`, { fecha: fechaRaw, slot: slotName });
    }
  } else if (!shouldBlock && isBlocked) {
    // DESBLOQUEAR
    if (realBookeoId && realBookeoId !== "Accepted") {
      await enqueueWebhook({
        action: "DESBLOQUEAR",
        shiftId: shiftId,
        payload: {
          accion: "desbloquear",
          blockId: realBookeoId,
          shiftId: shiftId,
        },
        emailData: null,
      });
      // Limpiar estado email si existiera (aunque usamos el hash general)
      await db
        .collection("bookeo_blocks")
        .doc(`${fechaRaw}_${slotName}_EMAIL_STATE`)
        .delete()
        .catch(() => { });
    } else {
      logger.error(
        `⚠️ No se puede desbloquear ${slotName}: ID inválido o pendiente`,
        { fecha: fechaRaw, id: realBookeoId }
      );
    }
  } else if (shouldBlock && isBlocked) {
    // FIX: Auto-desbloquear si está bloqueado pero tiene tour existente
    const tieneTour = await slotTieneTour(db, fechaRaw, slotName);
    if (tieneTour && realBookeoId && realBookeoId !== "Accepted") {
      logger.info(`🔓 Auto-desbloqueando ${slotName} - tour existente detectado`, { fecha: fechaRaw, slot: slotName });
      await enqueueWebhook({
        action: "DESBLOQUEAR",
        shiftId: shiftId,
        payload: {
          accion: "desbloquear",
          blockId: realBookeoId,
          shiftId: shiftId,
        },
        emailData: null,
      });
    }
  }
}

// =========================================
// HELPERS
// =========================================
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

/**
 * Verifica si algún guía tiene un tour asignado en un slot específico.
 * Si hay tour, no se debe bloquear ese slot en Bookeo porque ya existe reserva.
 */
async function slotTieneTour(db, fecha, slot) {
  const guides = await db.collection("guides").where("estado", "==", "activo").get();
  if (guides.empty) return false;

  const shiftRefs = guides.docs.map(doc =>
    db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${slot}`)
  );

  const shiftSnaps = await db.getAll(...shiftRefs);

  for (const shift of shiftSnaps) {
    if (shift.exists && shift.data().estado === "ASIGNADO") {
      logger.info("🔍 Tour detectado - NO se bloqueará", { fecha, slot, shiftId: shift.id });
      return true;
    }
  }
  return false;
}

async function calcularDisponibilidadSlot(db, fecha, slot) {
  const snapshot = await db
    .collection("guides")
    .where("estado", "==", "activo")
    .get();

  if (snapshot.empty) return { unavailableCount: 0, debeBloquear: false, debeDesbloquear: false };

  const shiftRefs = snapshot.docs.map(doc =>
    db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${slot}`)
  );

  const shiftSnaps = await db.getAll(...shiftRefs);
  let unavailableCount = 0;

  for (const shift of shiftSnaps) {
    if (shift.exists && (shift.data().estado === "NO_DISPONIBLE" || shift.data().estado === "ASIGNADO")) {
      unavailableCount++;
    }
  }

  return {
    unavailableCount,
    debeBloquear: unavailableCount === snapshot.size,
    debeDesbloquear: unavailableCount < snapshot.size,
  };
}

async function calcularDisponibilidadTarde(db, fecha) {
  const snapshot = await db
    .collection("guides")
    .where("estado", "==", "activo")
    .get();

  if (snapshot.empty) {
    return { guidesDisponiblesTarde: 0, debeBloquear: false, debeDesbloquear: false };
  }

  const shiftRefs = [];
  snapshot.docs.forEach(doc => {
    TARDE_SLOTS.forEach(s => {
      shiftRefs.push(db.collection("guides").doc(doc.id).collection("shifts").doc(`${fecha}_${s}`));
    });
  });

  const shiftSnaps = await db.getAll(...shiftRefs);

  // Agrupamos por guía para verificar si alguno de sus slots está bloqueado
  const shiftsByGuide = {};
  shiftSnaps.forEach(snap => {
    // Extraemos guideId de la ruta del documento: guides/{guideId}/shifts/{shiftId}
    const pathParts = snap.ref.path.split('/');
    const guideId = pathParts[1];
    if (!shiftsByGuide[guideId]) shiftsByGuide[guideId] = [];
    shiftsByGuide[guideId].push(snap);
  });

  let blocked = 0;
  for (const guideId in shiftsByGuide) {
    const guideShifts = shiftsByGuide[guideId];
    const isActuallyBlocked = guideShifts.some(snap =>
      snap.exists && (snap.data().estado === "NO_DISPONIBLE" || snap.data().estado === "ASIGNADO")
    );
    if (isActuallyBlocked) blocked++;
  }

  const disp = snapshot.size - blocked;
  return {
    guidesDisponiblesTarde: disp,
    debeBloquear: disp === 0,
    debeDesbloquear: disp > 0,
  };
}

async function enqueueWebhook({ action, shiftId, payload, emailData }) {
  try {
    const queue = getFunctions().taskQueue(
      "locations/us-central1/functions/bookeoWebhookWorker"
    );
    await queue.enqueue(
      { action, payload, shiftId, emailData },
      { scheduleDelaySeconds: DEBOUNCE_SECONDS }
    );
  } catch (e) {
    logger.error("Error encolando tarea Bookeo", e);
  }
}

function generarEmail(fecha, turno) {
  return `<p>Alerta: No hay guías para ${fecha} (${turno}). Solicitado bloqueo a Make.</p>`;
}

// Healthcheck sencillo
exports.freshStartBookeo = onRequest((req, res) =>
  res.json({ msg: "Ok" })
);
