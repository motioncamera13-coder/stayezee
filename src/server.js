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
// Uses approved template: checkin_message
// {{1}}=guestName, {{2}}=room, {{3}}=checkout, {{4}}=plan
app.post("/api/checkin", requireApiKey, async (req, res) => {
  try {
    const { phone, guestName, room, checkout, plan, wifi } = req.body;

    if (!phone || !guestName) {
      return res.status(400).json({ success: false, error: "phone and guestName are required" });
    }

    const mobile = phone.replace(/\D/g, "");
    const to = mobile.startsWith("91") ? mobile : "91" + mobile;

    await sendTemplate(to, "checkin_message", [
      guestName,
      room     || "Your room",
      checkout || "As booked",
      plan     || "As booked",
    ]);

    console.log(`✓ Check-in template sent to ${to} for ${guestName}`);
    res.json({ success: true, message: `Check-in message sent to ${to}` });
  } catch (err) {
    console.error("Check-in API error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/checkout ─────────────────────────────────────────────────────
// Uses approved template: checkout_bill
// {{1}}=guestName, {{2}}=roomCharges, {{3}}=gst, {{4}}=total
app.post("/api/checkout", requireApiKey, async (req, res) => {
  try {
    const { phone, guestName, roomCharges, gst, total, reviewLink } = req.body;

    if (!phone || !guestName) {
      return res.status(400).json({ success: false, error: "phone and guestName are required" });
    }

    const mobile = phone.replace(/\D/g, "");
    const to = mobile.startsWith("91") ? mobile : "91" + mobile;

    await sendTemplate(to, "checkout_bill", [
      guestName,
      String(Number(roomCharges || 0).toLocaleString()),
      String(Number(gst || 0).toLocaleString()),
      String(Number(total || 0).toLocaleString()),
    ]);

    // Send review link as a separate message if provided (within 24hr window)
    if (reviewLink) {
      await sendMessage(to,
        `⭐ We'd love your feedback!\n\nPlease share your experience:\n${reviewLink}\n\nTeam ${HOTEL_NAME}`
      );
    }

    console.log(`✓ Checkout template sent to ${to} for ${guestName}`);
    res.json({ success: true, message: `Checkout message sent to ${to}` });
  } catch (err) {
    console.error("Checkout API error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/message ──────────────────────────────────────────────────────
// Send any custom message to a guest (only works within 24hr window)
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
});
