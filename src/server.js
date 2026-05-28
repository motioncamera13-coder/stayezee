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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

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
//  SINGLE API ENDPOINT — POST /api/send
//  Header: x-api-key: stayezee-pms-key-2024
//
//  Types:
//  - reservation  → guest_reservation template
//  - cancel       → cancel_reservation template
//  - checkin      → checkin_message template
//  - checkout     → checkout_bill template
//  - food         → food_bill template
//  - message      → custom text message
// ══════════════════════════════════════════════════════════════════════════
app.post("/api/send", requireApiKey, async (req, res) => {
  try {
    const {
      type, phone, guestName,
      // reservation & cancel fields
      bookingNo, arrivalDate, departureDate, rooms, roomType, tariff, pax, plan,
      // checkin fields
      grNo, roomNo, checkinDate, checkoutDate,
      // checkout fields
      roomCharges, gst, total, reviewLink,
      // food bill fields
      billNo, billDate, outletName, billAmount,
      // custom message
      message
    } = req.body;

    if (!type || !phone) {
      return res.status(400).json({ success: false, error: "type and phone are required" });
    }

    const to = formatPhone(phone);

    // ── RESERVATION CONFIRMED ──────────────────────────────────────────────
    if (type === "reservation") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });

      await sendTemplate(to, "guest_reservation", {
        guest_name:     guestName,
        booking_no:     bookingNo     || "—",
        arrival_date:   arrivalDate   || "—",
        departure_date: departureDate || "—",
        rooms:          String(rooms  || "1"),
        room_type:      roomType      || "—",
        tariff:         String(tariff || "—"),
        pax:            String(pax    || "1"),
        plan:           plan          || "—",
      });

      console.log(`✓ Reservation template sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Reservation message sent to ${to}` });
    }

    // ── CANCEL RESERVATION ─────────────────────────────────────────────────
    if (type === "cancel") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });

      await sendTemplate(to, "cancel_reservation", {
        guest_name:     guestName,
        booking_no:     bookingNo     || "—",
        arrival_date:   arrivalDate   || "—",
        departure_date: departureDate || "—",
        rooms:          String(rooms  || "1"),
        room_type:      roomType      || "—",
        tariff:         String(tariff || "—"),
        pax:            String(pax    || "1"),
        plan:           plan          || "—",
      });

      console.log(`✓ Cancel template sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Cancellation message sent to ${to}` });
    }

    // ── CHECK-IN ───────────────────────────────────────────────────────────
    if (type === "checkin") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });

      await sendTemplate(to, "checkin_message", {
        guest_name:    guestName,
        gr_no:         grNo         || "—",
        room_no:       roomNo       || "—",
        checkin_date:  checkinDate  || "—",
        checkout_date: checkoutDate || "—",
        plan:          plan         || "—",
      });

      console.log(`✓ Checkin template sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Checkin message sent to ${to}` });
    }

    // ── CHECKOUT BILL ──────────────────────────────────────────────────────
    if (type === "checkout") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });

      await sendTemplate(to, "checkout_bill", {
        guest_name:   guestName,
        room_charges: String(Number(roomCharges || 0).toLocaleString()),
        gst:          String(Number(gst         || 0).toLocaleString()),
        total:        String(Number(total       || 0).toLocaleString()),
        review_link:  reviewLink || "https://g.page/r/stayezee",
      });

      console.log(`✓ Checkout template sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Checkout message sent to ${to}` });
    }

    // ── FOOD BILL ──────────────────────────────────────────────────────────
    if (type === "food") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });

      await sendTemplate(to, "food_bill", {
        guest_name:   guestName,
        bill_no:      billNo      || "—",
        bill_date:    billDate    || "—",
        outlet_name:  outletName  || "Restaurant",
        bill_amount:  String(Number(billAmount || 0).toLocaleString()),
      });

      console.log(`✓ Food bill template sent to ${to} for ${guestName}`);
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
