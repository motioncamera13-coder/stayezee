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

// ── Hotel Registry ─────────────────────────────────────────────────────────
const HOTELS = {
  "demohotel": {
    name:       "Stayezee",
    phone:      "+91 72300 91101",
    reviewLink: "https://g.page/r/stayezee",
  },
  "990424666": {
    name:       "Hotel Blue Moon",
    phone:      "0145-2427767 | 9829179669",
    reviewLink: "",
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

// ── 15-minute admin digest ─────────────────────────────────────────────────
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
}, 15 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════════
//  SINGLE API — POST /api/send
//
//  Template variable mapping:
//
//  checkin_messages:
//    {{1}}=hotelName {{2}}=hotelPhone {{3}}=guestName {{4}}=grNo
//    {{5}}=roomNo {{6}}=checkinDate {{7}}=checkoutDate {{8}}=plan {{9}}=wifi
//
//  checkout_messages:
//    {{1}}=hotelName {{2}}=hotelPhone {{3}}=guestName {{4}}=roomCharges
//    {{5}}=gst {{6}}=total {{7}}=reviewLink
//
//  reservation_message:
//    {{1}}=hotelName {{2}}=hotelPhone {{3}}=bookingNo {{4}}=arrivalDate
//    {{5}}=departureDate {{6}}=rooms {{7}}=roomType {{8}}=tariff {{9}}=pax {{10}}=plan
//
//  cancel_reservations:
//    {{1}}=hotelName {{2}}=hotelPhone {{3}}=bookingNo {{4}}=arrivalDate
//    {{5}}=departureDate {{6}}=rooms {{7}}=roomType {{8}}=tariff {{9}}=pax {{10}}=plan
//
//  food_messages:
//    {{1}}=hotelName {{2}}=hotelPhone {{3}}=guestName {{4}}=billNo
//    {{5}}=billDate {{6}}=outletName {{7}}=billAmount
// ══════════════════════════════════════════════════════════════════════════
app.post("/api/send", requireApiKey, async (req, res) => {
  try {
    const {
      type, phone, hotelId, guestName,
      bookingNo, arrivalDate, departureDate, rooms, roomType, tariff, pax, plan,
      grNo, roomNo, checkinDate, checkoutDate, wifi,
      roomCharges, gst, total, reviewLink,
      billNo, billDate, outletName, billAmount,
      message
    } = req.body;

    if (!type || !phone) {
      return res.status(400).json({ success: false, error: "type and phone are required" });
    }

    const to = formatPhone(phone);
    const hotel = getHotel(hotelId);
    const hName  = req.body.hotelName  || hotel.name;
    const hPhone = req.body.hotelPhone || hotel.phone;

    // ── CHECKIN ──────────────────────────────────────────────────────────
    // {{1}}=hotelName {{2}}=hotelPhone {{3}}=guestName {{4}}=grNo
    // {{5}}=roomNo {{6}}=checkinDate {{7}}=checkoutDate {{8}}=plan {{9}}=wifi
    if (type === "checkin") {
      await sendTemplate(to, "checkin_messages", [
        hName,
        hPhone,
        guestName    || "Guest",
        grNo         || "—",
        roomNo       || "—",
        checkinDate  || "—",
        checkoutDate || "—",
        plan         || "—",
        wifi         || "Ask reception",
      ]);
      console.log(`✓ Checkin sent to ${to}`);
      return res.json({ success: true, message: `Checkin message sent to ${to}` });
    }

    // ── CHECKOUT ─────────────────────────────────────────────────────────
    // {{1}}=hotelName {{2}}=hotelPhone {{3}}=guestName {{4}}=roomCharges
    // {{5}}=gst {{6}}=total {{7}}=reviewLink
    if (type === "checkout") {
      await sendTemplate(to, "checkout_messages", [
        hName,
        hPhone,
        guestName    || "Guest",
        String(Number(roomCharges || 0).toLocaleString()),
        String(Number(gst        || 0).toLocaleString()),
        String(Number(total      || 0).toLocaleString()),
        reviewLink || hotel.reviewLink || "—",
      ]);
      console.log(`✓ Checkout sent to ${to}`);
      return res.json({ success: true, message: `Checkout message sent to ${to}` });
    }

    // ── RESERVATION ──────────────────────────────────────────────────────
    // {{1}}=hotelName {{2}}=hotelPhone {{3}}=bookingNo {{4}}=arrivalDate
    // {{5}}=departureDate {{6}}=rooms {{7}}=roomType {{8}}=tariff {{9}}=pax {{10}}=plan
    if (type === "reservation") {
      await sendTemplate(to, "reservation_message", [
        hName,
        hPhone,
        bookingNo     || "—",
        arrivalDate   || "—",
        departureDate || "—",
        String(rooms  || "1"),
        roomType      || "—",
        String(tariff || "—"),
        String(pax    || "1"),
        plan          || "—",
      ]);
      console.log(`✓ Reservation sent to ${to}`);
      return res.json({ success: true, message: `Reservation message sent to ${to}` });
    }

    // ── CANCEL ───────────────────────────────────────────────────────────
    // {{1}}=hotelName {{2}}=hotelPhone {{3}}=bookingNo {{4}}=arrivalDate
    // {{5}}=departureDate {{6}}=rooms {{7}}=roomType {{8}}=tariff {{9}}=pax {{10}}=plan
    if (type === "cancel") {
      await sendTemplate(to, "cancel_reservations", [
        hName,
        hPhone,
        bookingNo     || "—",
        arrivalDate   || "—",
        departureDate || "—",
        String(rooms  || "1"),
        roomType      || "—",
        String(tariff || "—"),
        String(pax    || "1"),
        plan          || "—",
      ]);
      console.log(`✓ Cancel sent to ${to}`);
      return res.json({ success: true, message: `Cancellation message sent to ${to}` });
    }

    // ── FOOD BILL ────────────────────────────────────────────────────────
    // {{1}}=hotelName {{2}}=hotelPhone {{3}}=guestName {{4}}=billNo
    // {{5}}=billDate {{6}}=outletName {{7}}=billAmount
    if (type === "food") {
      await sendTemplate(to, "food_messages", [
        hName,
        hPhone,
        guestName    || "Guest",
        billNo       || "—",
        billDate     || "—",
        outletName   || "Restaurant",
        String(Number(billAmount || 0).toLocaleString()),
      ]);
      console.log(`✓ Food bill sent to ${to}`);
      return res.json({ success: true, message: `Food bill sent to ${to}` });
    }

    // ── CUSTOM MESSAGE ───────────────────────────────────────────────────
    // ── CHECKIN OWNER NOTIFICATION ───────────────────────────────────────
    // {{1}}=grNo {{2}}=guestName {{3}}=rooms {{4}}=roomNo {{5}}=tariff
    // {{6}}=extraBedTariff {{7}}=checkinTime {{8}}=pax {{9}}=nights
    // {{10}}=occupiedRooms {{11}}=availableRooms {{12}}=blockedRooms {{13}}=outOfOrder
    if (type === "checkin_owner") {
      const { grNo, guestName, rooms, roomNo, tariff, extraBedTariff,
              checkinTime, pax, nights, occupiedRooms, availableRooms,
              blockedRooms, outOfOrder } = req.body;
      await sendTemplate(to, "checkin_owner_notification", [
        grNo            || "—",
        guestName       || "Guest",
        String(rooms    || "1"),
        roomNo          || "—",
        String(tariff   || "0"),
        String(extraBedTariff || "0.00"),
        checkinTime     || "—",
        String(pax      || "1"),
        String(nights   || "1"),
        String(occupiedRooms  || "0"),
        String(availableRooms || "0"),
        String(blockedRooms   || "0"),
        String(outOfOrder     || "0"),
      ]);
      console.log(`✓ Checkin owner notification sent to ${to}`);
      return res.json({ success: true, message: `Checkin owner notification sent to ${to}` });
    }

    // ── CHECKOUT OWNER NOTIFICATION ──────────────────────────────────────
    // {{1}}=invoiceNo {{2}}=guestName {{3}}=grNo {{4}}=roomNo {{5}}=roomTariff
    // {{6}}=extraBed {{7}}=fnbCharges {{8}}=advance {{9}}=totalBill
    // {{10}}=occupiedRooms {{11}}=availableRooms {{12}}=blockedRooms {{13}}=outOfOrder
    if (type === "checkout_owner") {
      const { invoiceNo, guestName, grNo, roomNo, roomTariff, extraBed,
              fnbCharges, advance, totalBill, occupiedRooms, availableRooms,
              blockedRooms, outOfOrder } = req.body;
      await sendTemplate(to, "checkout_owner_notification", [
        invoiceNo       || "—",
        guestName       || "Guest",
        grNo            || "—",
        roomNo          || "—",
        String(roomTariff  || "0.00"),
        String(extraBed    || "0.00"),
        String(fnbCharges  || "0.00"),
        String(advance     || "0.00"),
        String(totalBill   || "0.00"),
        String(occupiedRooms  || "0"),
        String(availableRooms || "0"),
        String(blockedRooms   || "0"),
        String(outOfOrder     || "0"),
      ]);
      console.log(`✓ Checkout owner notification sent to ${to}`);
      return res.json({ success: true, message: `Checkout owner notification sent to ${to}` });
    }

    // ── DAILY SALES REPORT ───────────────────────────────────────────────
    // {{1}}=salesDate {{2}}=dineInRevenue {{3}}=cash
    if (type === "daily_sales") {
      const { salesDate, dineInRevenue, cash } = req.body;
      await sendTemplate(to, "daily_sales_report", [
        salesDate       || "—",
        String(dineInRevenue || "0"),
        String(cash          || "0"),
      ]);
      console.log(`✓ Daily sales report sent to ${to}`);
      return res.json({ success: true, message: `Daily sales report sent to ${to}` });
    }

    // ── CUSTOM MESSAGE ───────────────────────────────────────────────────
    if (type === "message") {
      if (!message) return res.status(400).json({ success: false, error: "message is required" });
      await sendMessage(to, message);
      console.log(`✓ Custom message sent to ${to}`);
      return res.json({ success: true, message: `Message sent to ${to}` });
    }

    return res.status(400).json({
      success: false,
      error: `Unknown type "${type}". Use: reservation, cancel, checkin, checkout, food, checkin_owner, checkout_owner, daily_sales, message`
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
