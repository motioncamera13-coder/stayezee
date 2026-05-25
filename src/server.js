require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const { handleIncoming } = require("./handler");
const { sendMessage, sendTemplate } = require("./whatsapp");

const HOTEL_NAME     = process.env.HOTEL_NAME     || "Stayezee";
const HOTEL_LOCATION = process.env.HOTEL_LOCATION || "Manali, Himachal Pradesh";
const HOTEL_PHONE    = process.env.HOTEL_PHONE    || "+91 72300 91101";
const API_KEY        = process.env.PMS_API_KEY    || "stayezee-pms-key-2024";

// ── API Key middleware ─────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (!key || key !== API_KEY) {
    return res.status(401).json({ success: false, error: "Invalid or missing API key" });
  }
  next();
}

function formatPhone(phone) {
  const mobile = phone.replace(/\D/g, "");
  return mobile.startsWith("91") ? mobile : "91" + mobile;
}

// ── Health check ───────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "Stayezee Manali bot running ✓" }));

// ── Webhook verification ───────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "stayezee_manali_verify_2024";
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✓ Webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Incoming WhatsApp messages ─────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || messages.length === 0) return;

    const msg = messages[0];
    const from = msg.from;
    const msgType = msg.type;
    let text = "", mediaId = null;

    if (msgType === "text")       { text = msg.text?.body || ""; }
    else if (msgType === "image") { mediaId = msg.image?.id || null; text = msg.image?.caption || ""; }
    else return;

    console.log(`📨 From ${from} [${msgType}]: ${text}`);
    await handleIncoming({ from, text, msgId: msg.id, msgType, mediaId });
  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  SINGLE API ENDPOINT for Stayezee PMS
//  POST /api/send
//  Header: x-api-key: stayezee-pms-key-2024
// ══════════════════════════════════════════════════════════════════════════
app.post("/api/send", requireApiKey, async (req, res) => {
  try {
    const { type, phone, guestName, room, checkin, checkout, plan, wifi,
            roomCharges, gst, total, reviewLink, reservationId, message } = req.body;

    if (!type || !phone) {
      return res.status(400).json({ success: false, error: "type and phone are required" });
    }

    const to = formatPhone(phone);

    // ── CHECKIN ────────────────────────────────────────────────────────────
    // Sends 2 messages:
    // 1. booking_confirmation — Thank you for choosing us
    // 2. checkin_message — Welcome + room details
    if (type === "checkin") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });

      // Message 1 — Thank you / booking confirmation
      await sendTemplate(to, "booking_confirmation", [
        guestName,
        reservationId || "—",
        room          || "As booked",
        checkin       || "As booked",
        checkout      || "As booked",
        plan          || "As booked",
      ]);

      // Small delay between messages
      await new Promise(r => setTimeout(r, 2000));

      // Message 2 — Welcome + room details
      await sendTemplate(to, "checkin_message", [
        guestName,
        room     || "Your room",
        checkout || "As booked",
        plan     || "As booked",
      ]);

      console.log(`✓ Check-in messages sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Check-in messages sent to ${to}` });
    }

    // ── CHECKOUT ───────────────────────────────────────────────────────────
    // Sends checkout bill message
    if (type === "checkout") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });

      await sendTemplate(to, "checkout_bill", [
        guestName,
        String(Number(roomCharges || 0).toLocaleString()),
        String(Number(gst        || 0).toLocaleString()),
        String(Number(total      || 0).toLocaleString()),
      ]);

      if (reviewLink) {
        await new Promise(r => setTimeout(r, 2000));
        await sendMessage(to,
          `⭐ We'd love your feedback!\n\nPlease share your experience:\n${reviewLink}\n\nTeam ${HOTEL_NAME}`
        );
      }

      console.log(`✓ Checkout messages sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Checkout message sent to ${to}` });
    }

    // ── CUSTOM MESSAGE ─────────────────────────────────────────────────────
    if (type === "message") {
      if (!message) return res.status(400).json({ success: false, error: "message is required" });
      await sendMessage(to, message);
      console.log(`✓ Custom message sent to ${to}`);
      return res.json({ success: true, message: `Message sent to ${to}` });
    }

    return res.status(400).json({
      success: false,
      error: `Unknown type "${type}". Use: checkin, checkout, or message`
    });

  } catch (err) {
    console.error("API /send error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🏔️ Stayezee Manali bot running on port ${PORT}`);
  console.log(`🔑 PMS API Key: ${API_KEY}`);
  console.log(`📡 Single API: POST /api/send`);
});
