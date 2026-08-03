require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const { handleIncoming, getEnquiryLog, clearEnquiryLog } = require("./handler");
const { sendMessage, sendTemplate } = require("./whatsapp");

const HOTEL_NAME  = process.env.HOTEL_NAME  || "Stayezee";
const HOTEL_PHONE = process.env.HOTEL_PHONE || "+91 72300 91101";
const API_KEY     = process.env.PMS_API_KEY || "demohotel";
const ADMIN_PHONE = process.env.ADMIN_PHONE || "919116091107";

// ── Hotel Registry — add new hotels here ──────────────────────────────────
const HOTELS = {
  // Stayezee Manali (default)
  "demohotel": {
    name:        "Stayezee",
    location:    "Manali, Himachal Pradesh",
    phone:       "+91 72300 91101",
    reviewLink:  "https://g.page/r/stayezee",
  },
  // Hotel Blue Moon, Ajmer
  "990424666": {
    name:        "Hotel Blue Moon",
    location:    "Ajmer, Rajasthan",
    phone:       "0145-2427767 | 9829179669",
    reviewLink:  "",
  },
};

function getHotel(hotelId) {
  return HOTELS[hotelId] || HOTELS["demohotel"];
}

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
//  15-MINUTE ADMIN DIGEST
//  Every 15 mins, send all new enquiries to admin
// ══════════════════════════════════════════════════════════════════════════
setInterval(async () => {
  try {
    const log = getEnquiryLog();
    if (!log || log.length === 0) return;

    let msg = `📊 *15-Min Enquiry Report — ${HOTEL_NAME}*\n`;
    msg += `🕐 ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n\n`;

    log.forEach((e, i) => {
      msg += `*${i + 1}. ${e.name || "Unknown"}*\n`;
      msg += `📞 ${e.phone}\n`;
      msg += `📋 Status: ${e.status}\n`;
      if (e.dates) msg += `📅 ${e.dates}\n`;
      if (e.rooms) msg += `🛏 ${e.rooms}\n`;
      msg += `\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `Total: ${log.length} enquir${log.length === 1 ? "y" : "ies"}`;

    await sendMessage(ADMIN_PHONE, msg);
    clearEnquiryLog();
    console.log(`✓ Admin digest sent — ${log.length} enquiries`);
  } catch (err) {
    console.error("Admin digest error:", err.message);
  }
}, 15 * 60 * 1000); // every 15 minutes

// ══════════════════════════════════════════════════════════════════════════
//  SINGLE API — POST /api/send
// ══════════════════════════════════════════════════════════════════════════
app.post("/api/send", requireApiKey, async (req, res) => {
  try {
    const {
      type, phone, guestName, hotelId,
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
    const hotel = getHotel(hotelId);

    if (type === "reservation") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "_guest_reservation", [
        guestName, bookingNo || "—", arrivalDate || "—", departureDate || "—",
        String(rooms || "1"), roomType || "—", String(tariff || "—"), String(pax || "1"), plan || "—",
      ]);
      console.log(`✓ Reservation sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Reservation message sent to ${to}` });
    }

    if (type === "cancel") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "cancel_reservation", [
        guestName, bookingNo || "—", arrivalDate || "—", departureDate || "—",
        String(rooms || "1"), roomType || "—", String(tariff || "—"), String(pax || "1"), plan || "—",
      ]);
      console.log(`✓ Cancel sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Cancellation message sent to ${to}` });
    }

    if (type === "checkin") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "checkin_message", [
        guestName, grNo || "—", roomNo || "—", checkinDate || "—", checkoutDate || "—", plan || "—",
      ]);
      console.log(`✓ Checkin sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Checkin message sent to ${to}` });
    }

    if (type === "checkout") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "checkout_bill", [
        guestName,
        String(Number(roomCharges || 0).toLocaleString()),
        String(Number(gst        || 0).toLocaleString()),
        String(Number(total      || 0).toLocaleString()),
        reviewLink || hotel.reviewLink || "—",
      ]);
      console.log(`✓ Checkout sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Checkout message sent to ${to}` });
    }

    if (type === "food") {
      if (!guestName) return res.status(400).json({ success: false, error: "guestName is required" });
      await sendTemplate(to, "food_bill", [
        guestName, billNo || "—", billDate || "—", outletName || "Restaurant",
        String(Number(billAmount || 0).toLocaleString()),
      ]);
      console.log(`✓ Food bill sent to ${to} for ${guestName}`);
      return res.json({ success: true, message: `Food bill sent to ${to}` });
    }

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
  console.log(`⏰ Admin digest: every 15 minutes to ${ADMIN_PHONE}`);
});
