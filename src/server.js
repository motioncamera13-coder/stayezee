require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const { handleIncoming } = require("./handler");
const { sendMessage } = require("./whatsapp");

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
//  PMS API — protected by x-api-key header
// ══════════════════════════════════════════════════════════════════════════

// ── POST /api/checkin ──────────────────────────────────────────────────────
// Called by Stayezee PMS when guest checks in
// Body: { phone, guestName, room, checkout, plan, wifi }
app.post("/api/checkin", requireApiKey, async (req, res) => {
  try {
    const { phone, guestName, room, checkout, plan, wifi } = req.body;

    if (!phone || !guestName) {
      return res.status(400).json({ success: false, error: "phone and guestName are required" });
    }

    const mobile = phone.replace(/\D/g, "");
    const to = mobile.startsWith("91") ? mobile : "91" + mobile;

    await sendMessage(to,
      `🏔️ *Welcome to ${HOTEL_NAME}, ${HOTEL_LOCATION}!*\n\n` +
      `Dear *${guestName}*,\n\n` +
      `You are now checked in. Here are your details:\n\n` +
      `🛏 Room: *${room || "Your room"}*\n` +
      `📅 Check-out: *${checkout || "As booked"}*\n` +
      `🍽 Plan: *${plan || "As booked"}*\n` +
      `📶 WiFi: *${wifi || "Ask reception"}*\n\n` +
      `For any assistance please call reception:\n` +
      `📞 ${HOTEL_PHONE}\n\n` +
      `We wish you a wonderful stay! 🙏\n` +
      `Team ${HOTEL_NAME}`
    );

    console.log(`✓ Check-in message sent to ${to} for ${guestName}`);
    res.json({ success: true, message: `Check-in message sent to ${to}` });
  } catch (err) {
    console.error("Check-in API error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/checkout ─────────────────────────────────────────────────────
// Called by Stayezee PMS when guest checks out
// Body: { phone, guestName, roomCharges, gst, total, reviewLink }
app.post("/api/checkout", requireApiKey, async (req, res) => {
  try {
    const { phone, guestName, roomCharges, gst, total, reviewLink } = req.body;

    if (!phone || !guestName) {
      return res.status(400).json({ success: false, error: "phone and guestName are required" });
    }

    const mobile = phone.replace(/\D/g, "");
    const to = mobile.startsWith("91") ? mobile : "91" + mobile;

    await sendMessage(to,
      `🙏 *Thank you for staying at ${HOTEL_NAME}!*\n\n` +
      `Dear *${guestName}*,\n\n` +
      `We hope you had a wonderful time in Manali! 🏔️\n\n` +
      `*Your Bill Summary:*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🛏 Room charges: Rs.${Number(roomCharges || 0).toLocaleString()}\n` +
      `🧾 GST: Rs.${Number(gst || 0).toLocaleString()}\n` +
      `💰 *Total: Rs.${Number(total || 0).toLocaleString()}*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `We would love to see you again! 😊\n\n` +
      (reviewLink
        ? `⭐ Please share your experience:\n${reviewLink}\n\n`
        : ``) +
      `Team ${HOTEL_NAME}\n` +
      `📞 ${HOTEL_PHONE}`
    );

    console.log(`✓ Checkout message sent to ${to} for ${guestName}`);
    res.json({ success: true, message: `Checkout message sent to ${to}` });
  } catch (err) {
    console.error("Checkout API error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/message ──────────────────────────────────────────────────────
// Send any custom message to a guest
// Body: { phone, message }
app.post("/api/message", requireApiKey, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: "phone and message are required" });
    }
    const mobile = phone.replace(/\D/g, "");
    const to = mobile.startsWith("91") ? mobile : "91" + mobile;
    await sendMessage(to, message);
    console.log(`✓ Custom message sent to ${to}`);
    res.json({ success: true, message: `Message sent to ${to}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🏔️ Stayezee Manali bot running on port ${PORT}`);
  console.log(`🔑 PMS API Key: ${API_KEY}`);
  console.log(`📡 API endpoints:`);
  console.log(`   POST /api/checkin`);
  console.log(`   POST /api/checkout`);
  console.log(`   POST /api/message`);
});
