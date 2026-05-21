require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const { handleIncoming } = require("./handler");

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

// ── Incoming messages ──────────────────────────────────────────────────────
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

    if (msgType === "text")  { text = msg.text?.body || ""; }
    else if (msgType === "image") { mediaId = msg.image?.id || null; text = msg.image?.caption || ""; }
    else return;

    console.log(`📨 From ${from} [${msgType}]: ${text}`);
    await handleIncoming({ from, text, msgId: msg.id, msgType, mediaId });
  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "Stayezee Manali bot running ✓" }));

// ── Guest check-in notification (called by PMS) ────────────────────────────
app.post("/send-checkin", async (req, res) => {
  try {
    const { phone, guestName, room, checkout, plan, wifi } = req.body;
    const { sendMessage } = require("./whatsapp");
    const HOTEL_INFO = {
      name: process.env.HOTEL_NAME || "Stayezee",
      location: process.env.HOTEL_LOCATION || "Manali",
    };
    await sendMessage(phone,
      `🏔️ *Welcome to ${HOTEL_INFO.name}, ${HOTEL_INFO.location}!*\n\n` +
      `Dear ${guestName},\n\n` +
      `You are now checked in!\n\n` +
      `🛏 Room: ${room || "Your room"}\n` +
      `📅 Check-out: ${checkout || "As booked"}\n` +
      `🍽 Plan: ${plan || "As booked"}\n` +
      `📶 WiFi: ${wifi || "Ask reception"}\n\n` +
      `For any assistance, please call reception. 🙏\n` +
      `We wish you a wonderful stay!`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Guest checkout message ─────────────────────────────────────────────────
app.post("/send-checkout", async (req, res) => {
  try {
    const { phone, guestName, roomCharges, gst, total, reviewLink } = req.body;
    const { sendMessage } = require("./whatsapp");
    await sendMessage(phone,
      `Dear ${guestName},\n\n` +
      `Thank you for staying with us! 🙏\n\n` +
      `*Bill Summary:*\n` +
      `Room charges: Rs.${roomCharges}\n` +
      `GST: Rs.${gst}\n` +
      `Total: Rs.${total}\n\n` +
      `We hope to see you again in Manali! 🏔️\n\n` +
      (reviewLink ? `Please share your experience:\n${reviewLink}` : "")
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🏔️ Stayezee Manali bot running on port ${PORT}`));
