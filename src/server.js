require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const { handleIncoming } = require("./handler");
const { sendMessage, sendTemplate } = require("./whatsapp");

const HOTEL_NAME  = process.env.HOTEL_NAME  || "Stayezee";
const HOTEL_PHONE = process.env.HOTEL_PHONE || "+91 72300 91101";
const API_KEY     = process.env.PMS_API_KEY || "stayezee-pms-key-2024";

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

app.get("/", (req, res) => res.json({ status: "Stayezee Manali bot running ✓" }));

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
//  SINGLE API — POST /api/send
//  Types: reservation, cancel, checkin, checkout, food, message
// ══════════════════════════════════════════════════════════════════════════
app.post("/api/send", requireApiKey, async (req, res) => {
  try {
    const {
      type, phone, guestName,
      bookingNo, arrivalDate, departureDate, rooms, roomType, tariff, pax, plan,
      grNo, roomNo, checkinDate, checkoutDate,
      roomCharges, gst, total, reviewLink,
      billNo, billDate, outletName, billAmount,
      message
    } = req.body;

    if (!type || !phone) {
      return res.status(400).json({ success: false, error: "type and phone are required" });
    }

    const to = formatPhone(phone);

    // ── RESERVATION ────────────────────────────────────────────────────────
    // {{1}}=guestName {{2}}=bookingNo {{3}}=arrivalDate {{4}}=departureDate
    // {{5}}=rooms {{6}}=roomType {{7}}=tariff {{8}}=pax {{9}}=plan
    if (type === "reservation") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "_guest_reservation", [
        guestName,
        bookingNo     || "—",
        arrivalDate   || "—",
        departureDate || "—",
        String(rooms  || "1"),
        roomType      || "—",
        String(tariff || "—"),
        String(pax    || "1"),
        plan          || "—",
      ]);
      console.log(`✓ Reservation sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Reservation message sent to ${to}` });
    }

    // ── CANCEL ─────────────────────────────────────────────────────────────
    // {{1}}=guestName {{2}}=bookingNo {{3}}=arrivalDate {{4}}=departureDate
    // {{5}}=rooms {{6}}=roomType {{7}}=tariff {{8}}=pax {{9}}=plan
    if (type === "cancel") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "_cancel_reservation", [
        guestName,
        bookingNo     || "—",
        arrivalDate   || "—",
        departureDate || "—",
        String(rooms  || "1"),
        roomType      || "—",
        String(tariff || "—"),
        String(pax    || "1"),
        plan          || "—",
      ]);
      console.log(`✓ Cancel sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Cancellation message sent to ${to}` });
    }

    // ── CHECKIN ────────────────────────────────────────────────────────────
    // {{1}}=guestName {{2}}=grNo {{3}}=roomNo {{4}}=checkinDate
    // {{5}}=checkoutDate {{6}}=plan
    if (type === "checkin") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "_checkin_message", [
        guestName,
        grNo         || "—",
        roomNo       || "—",
        checkinDate  || "—",
        checkoutDate || "—",
        plan         || "—",
      ]);
      console.log(`✓ Checkin sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Checkin message sent to ${to}` });
    }

    // ── CHECKOUT ───────────────────────────────────────────────────────────
    // {{1}}=guestName {{2}}=roomCharges {{3}}=gst {{4}}=total {{5}}=reviewLink
    if (type === "checkout") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "_checkout_bill", [
        guestName,
        String(Number(roomCharges || 0).toLocaleString()),
        String(Number(gst        || 0).toLocaleString()),
        String(Number(total      || 0).toLocaleString()),
        reviewLink || "https://g.page/r/stayezee",
      ]);
      console.log(`✓ Checkout sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Checkout message sent to ${to}` });
    }

    // ── FOOD BILL ──────────────────────────────────────────────────────────
    // {{1}}=guestName {{2}}=billNo {{3}}=billDate {{4}}=outletName {{5}}=billAmount
    if (type === "food") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "_food_bill", [
        guestName,
        billNo     || "—",
        billDate   || "—",
        outletName || "Restaurant",
        String(Number(billAmount || 0).toLocaleString()),
      ]);
      console.log(`✓ Food bill sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Food bill sent to ${to}` });
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
      error: `Unknown type "${type}". Use: reservation, cancel, checkin, checkout, food, message`
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
  console.log(`📋 Types: reservation, cancel, checkin, checkout, food, message`);
});
