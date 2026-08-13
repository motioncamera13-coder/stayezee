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

const HOTELS = {
  "demohotel": { name: "Stayezee", phone: "+91 72300 91101", reviewLink: "https://g.page/r/stayezee" },
  "990424666": { name: "Hotel Blue Moon", phone: "0145-2427767 | 9829179669", reviewLink: "" },
  "701125899": { name: "Elysian Hotel & Restaurant", phone: "+91 99834 90068", reviewLink: "" },
};

function getHotel(hotelId) { return HOTELS[hotelId] || HOTELS["demohotel"]; }

const VALID_API_KEYS = [API_KEY, "701125899", "990424666"];

function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (!key || !VALID_API_KEYS.includes(key)) {
    return res.status(401).json({ success: false, error: "Invalid or missing API key" });
  }
  next();
}

function formatPhone(phone) {
  const mobile = phone.replace(/\D/g, "");
  return mobile.startsWith("91") ? mobile : "91" + mobile;
}

app.get("/", (req, res) => res.json({ status: "Stayezee Manali bot running" }));

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "stayezee_manali_verify_2024";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
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
    if (msgType === "text") { text = msg.text?.body || ""; }
    else if (msgType === "image") { mediaId = msg.image?.id || null; text = msg.image?.caption || ""; }
    else return;
    console.log("From " + from + ": " + text);
    await handleIncoming({ from, text, msgId: msg.id, msgType, mediaId });
  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

setInterval(async () => {
  try {
    const log = getEnquiryLog();
    if (!log || log.length === 0) return;
    let msg = "*15-Min Enquiry Report*\n\n";
    log.forEach((e, i) => {
      msg += (i+1) + ". " + (e.name || "Unknown") + "\n";
      msg += "Phone: " + e.phone + "\n";
      msg += "Status: " + e.status + "\n\n";
    });
    msg += "Total: " + log.length + " enquiries";
    await sendMessage(ADMIN_PHONE, msg);
    clearEnquiryLog();
  } catch (err) {
    console.error("Admin digest error:", err.message);
  }
}, 15 * 60 * 1000);

app.post("/api/send", requireApiKey, async (req, res) => {
  try {
    const {
      type, phone, hotelId, guestName,
      bookingNo, arrivalDate, departureDate, rooms, roomType, tariff, pax, plan,
      grNo, roomNo, checkinDate, checkoutDate, wifi,
      roomCharges, gst, total, reviewLink,
      billNo, billDate, outletName, billAmount,
      receiptNo, receiptType, advanceAmount, paymentMode, paymentDate, receiptTime,
      mobileNo, nights, extraBed, totalAmount,
      checkinUrl, mobile, loginTime,
      customerName, address, customerPhone, orderType, orderItems,
      subTotal, discount, tax, location,
      salesDate, outletWise, paymentWise,
      invoiceNo, roomTariff, fnbCharges, advance, totalBill,
      occupiedRooms, availableRooms, blockedRooms, outOfOrder,
      extraBedTariff, checkinTime,
      message
    } = req.body;

    if (!type || !phone) {
      return res.status(400).json({ success: false, error: "type and phone are required" });
    }

    const to = formatPhone(phone);
    const hotel = getHotel(hotelId);
    const hName  = req.body.hotelName  || hotel.name;
    const hPhone = req.body.hotelPhone || hotel.phone;

    if (type === "checkin") {
      await sendTemplate(to, "checkin_messages", [hName, hPhone, guestName||"Guest", grNo||"—", roomNo||"—", checkinDate||"—", checkoutDate||"—", plan||"—", wifi||"Ask reception"]);
      console.log("Checkin sent to " + to);
      return res.json({ success: true, message: "Checkin message sent to " + to });
    }
    if (type === "checkout") {
      await sendTemplate(to, "checkout_messages", [hName, hPhone, guestName||"Guest", String(Number(roomCharges||0).toLocaleString()), String(Number(gst||0).toLocaleString()), String(Number(total||0).toLocaleString()), reviewLink||hotel.reviewLink||"—"]);
      console.log("Checkout sent to " + to);
      return res.json({ success: true, message: "Checkout message sent to " + to });
    }
    if (type === "reservation") {
      await sendTemplate(to, "reservation_messages", [guestName||"Guest", bookingNo||"—", arrivalDate||"—", departureDate||"—", String(rooms||"1"), roomType||"—", String(tariff||"—"), String(pax||"1"), plan||"—"]);
      console.log("Reservation sent to " + to);
      return res.json({ success: true, message: "Reservation message sent to " + to });
    }
    if (type === "cancel") {
      await sendTemplate(to, "cancel_reservations", [hName, hPhone, bookingNo||"—", arrivalDate||"—", departureDate||"—", String(rooms||"1"), roomType||"—", String(tariff||"—"), String(pax||"1"), plan||"—"]);
      console.log("Cancel sent to " + to);
      return res.json({ success: true, message: "Cancellation message sent to " + to });
    }
    if (type === "food") {
      await sendTemplate(to, "food_messages", [hName, hPhone, guestName||"Guest", billNo||"—", billDate||"—", outletName||"Restaurant", String(Number(billAmount||0).toLocaleString())]);
      console.log("Food bill sent to " + to);
      return res.json({ success: true, message: "Food bill sent to " + to });
    }
    if (type === "checkin_owner") {
      await sendTemplate(to, "checkin_owner_notification", [grNo||"—", guestName||"Guest", String(rooms||"1"), roomNo||"—", String(tariff||"0"), String(extraBedTariff||"0.00"), checkinTime||"—", String(pax||"1"), String(nights||"1"), String(occupiedRooms||"0"), String(availableRooms||"0"), String(blockedRooms||"0"), String(outOfOrder||"0")]);
      console.log("Checkin owner sent to " + to);
      return res.json({ success: true, message: "Checkin owner notification sent to " + to });
    }
    if (type === "checkout_owner") {
      await sendTemplate(to, "checkout_owner_notification", [invoiceNo||"—", guestName||"Guest", grNo||"—", roomNo||"—", String(roomTariff||"0.00"), String(extraBed||"0.00"), String(fnbCharges||"0.00"), String(advance||"0.00"), String(totalBill||"0.00"), String(occupiedRooms||"0"), String(availableRooms||"0"), String(blockedRooms||"0"), String(outOfOrder||"0")]);
      console.log("Checkout owner sent to " + to);
      return res.json({ success: true, message: "Checkout owner notification sent to " + to });
    }
    if (type === "daily_sales") {
      await sendTemplate(to, "daily_sales_report", [salesDate||"—", outletWise||"—", paymentWise||"—"]);
      console.log("Daily sales sent to " + to);
      return res.json({ success: true, message: "Daily sales report sent to " + to });
    }
    if (type === "advance_payment") {
      await sendTemplate(to, "advance_payment_receipt", [receiptNo||"—", receiptType||"—", bookingNo||"—", guestName||"Guest", roomNo||"—", String(advanceAmount||"0"), paymentMode||"—", paymentDate||"—", receiptTime||"—", arrivalDate||"—", departureDate||"—"]);
      console.log("Advance payment sent to " + to);
      return res.json({ success: true, message: "Advance payment receipt sent to " + to });
    }
    if (type === "reservation_notification") {
      await sendTemplate(to, "reservation_notification", [bookingNo||"—", guestName||"Guest", mobileNo||"—", arrivalDate||"—", departureDate||"—", String(nights||"1"), roomType||"—", String(rooms||"1"), String(pax||"1"), String(extraBed||"0"), plan||"—", String(tariff||"0"), String(totalAmount||"0")]);
      console.log("Reservation notification sent to " + to);
      return res.json({ success: true, message: "Reservation notification sent to " + to });
    }
    if (type === "checkin_form") {
      await sendTemplate(to, "checkin_form_link", [checkinUrl||"—", hName]);
      console.log("Checkin form sent to " + to);
      return res.json({ success: true, message: "Checkin form link sent to " + to });
    }
    if (type === "receipt_notification") {
      await sendTemplate(to, "receipt_notification", [receiptNo||"—", receiptType||"—", bookingNo||"—", guestName||"Guest", roomNo||"—", String(advanceAmount||"0"), paymentMode||"—", paymentDate||"—", receiptTime||"—", arrivalDate||"—", departureDate||"—"]);
      console.log("Receipt notification sent to " + to);
      return res.json({ success: true, message: "Receipt notification sent to " + to });
    }
    if (type === "login_notification") {
      await sendTemplate(to, "login_notification", [guestName||"Guest", mobile||"—", loginTime||"—"]);
      console.log("Login notification sent to " + to);
      return res.json({ success: true, message: "Login notification sent to " + to });
    }
    if (type === "order_notification") {
      await sendTemplate(to, "order_notification", [hName, customerName||"Guest", address||"—", customerPhone||"—", orderType||"—", orderItems||"—", String(subTotal||"0"), String(discount||"0"), String(tax||"0"), String(totalAmount||"0"), paymentMode||"—", location||"—"]);
      console.log("Order notification sent to " + to);
      return res.json({ success: true, message: "Order notification sent to " + to });
    }
    if (type === "message") {
      if (!message) return res.status(400).json({ success: false, error: "message is required" });
      await sendMessage(to, message);
      console.log("Custom message sent to " + to);
      return res.json({ success: true, message: "Message sent to " + to });
    }

    return res.status(400).json({ success: false, error: "Unknown type: " + type });

  } catch (err) {
    console.error("API /send error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Stayezee Manali bot running on port " + PORT);
  console.log("PMS API Key: " + API_KEY);
  console.log("Single API: POST /api/send");
  console.log("Admin digest: every 15 minutes to " + ADMIN_PHONE);
});
