"use strict";
const { parseEnquiry } = require("./parser");
const { checkAvailability, saveReservation, cancelReservation } = require("./stayezee");
const { getRate } = require("./rates");
const { sendMessage, sendReminder } = require("./whatsapp");

const ADMIN_PHONE = process.env.ADMIN_PHONE || "919116091107";

// Session stores
const sessions = {};        // booking sessions per user
const pendingPayments = {}; // phone -> payment info after booking
const pendingCancellations = {};

const HOTEL_INFO = {
  name:      process.env.HOTEL_NAME       || "Stayezee",
  location:  process.env.HOTEL_LOCATION   || "Manali, Himachal Pradesh",
  phone:     process.env.HOTEL_PHONE      || "+91 72300 91101",
  checkIn:   process.env.HOTEL_CHECKIN_TIME  || "2:00 PM",
  checkOut:  process.env.HOTEL_CHECKOUT_TIME || "12:00 PM",
  googleMaps: "https://maps.google.com/?q=Manali",
};

const UPI_ID = process.env.UPI_ID || "7230091101@okbizaxis";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function calcNights(ci, co) {
  if (!ci || !co) return 0;
  return Math.max(0, Math.round((new Date(co) - new Date(ci)) / 86400000));
}

function genVoucher() {
  return "STZ" + Date.now().toString().slice(-8);
}

// ── MAIN ENTRY ───────────────────────────────────────────────────────────────
async function handleIncoming({ from, text, msgId, msgType, mediaId }) {
  const t = (text || "").trim().toUpperCase();
  console.log(`📨 From ${from}: ${text || "[media]"}`);

  // Payment screenshot from any user
  if (msgType === "image" && from !== ADMIN_PHONE) {
    const pending = pendingPayments[from];
    if (pending) {
      await sendMessage(from,
        `✅ *Payment screenshot received!*\n\n` +
        `Booking: *${pending.voucherNo}*\n` +
        `Guest: ${pending.guestName}\n` +
        `Amount: Rs.${pending.amount.toLocaleString()}\n\n` +
        `Pending admin confirmation. We'll notify you shortly. 🙏`
      );
      await sendReminder(ADMIN_PHONE,
        `📸 *PAYMENT RECEIVED*\n\n` +
        `Guest: ${pending.guestName} (${from})\n` +
        `Voucher: ${pending.voucherNo}\n` +
        `Amount: Rs.${pending.amount.toLocaleString()}\n` +
        `Check-in: ${fmtDate(pending.ciDate)}\n\n` +
        `APPROVE PAY ${from} ${pending.amount}\n` +
        `REJECT PAY ${from}`
      );
      return;
    }
  }

  // Admin commands
  if (from === ADMIN_PHONE) {
    await handleAdmin(from, text, t);
    return;
  }

  // Regular user flow
  await handleUser(from, text, t, msgType);
}

// ── ADMIN HANDLER ────────────────────────────────────────────────────────────
async function handleAdmin(from, text, t) {
  // APPROVE PAY <phone> <amount>
  if (t.startsWith("APPROVE PAY ")) {
    const parts = t.split(" ");
    const phone = parts[2];
    const amount = parseInt(parts[3]);
    const pending = pendingPayments[phone];
    if (!pending) {
      await sendMessage(from, `❌ No pending payment for ${phone}`);
      return;
    }
    pending.paidSoFar = (pending.paidSoFar || 0) + amount;
    await sendMessage(phone,
      `✅ *Payment Confirmed!*\n\n` +
      `Booking: *${pending.voucherNo}*\n` +
      `Guest: ${pending.guestName}\n` +
      `Paid: Rs.${pending.paidSoFar.toLocaleString()} / Rs.${pending.total.toLocaleString()}\n\n` +
      `Check-in: ${fmtDate(pending.ciDate)}\n` +
      `Check-out: ${fmtDate(pending.coDate)}\n\n` +
      `Hotel: ${HOTEL_INFO.name}, ${HOTEL_INFO.location}\n` +
      `📍 ${HOTEL_INFO.googleMaps}\n\n` +
      `Thank you! See you soon 🙏`
    );
    await sendMessage(from, `✅ Payment of Rs.${amount.toLocaleString()} approved for ${pending.guestName}`);
    return;
  }

  // REJECT PAY <phone>
  if (t.startsWith("REJECT PAY ")) {
    const phone = t.split(" ")[2];
    const pending = pendingPayments[phone];
    if (!pending) { await sendMessage(from, `❌ No pending payment for ${phone}`); return; }
    await sendMessage(phone,
      `❌ *Payment Not Confirmed*\n\n` +
      `Booking: *${pending.voucherNo}*\n\n` +
      `Please send a clear screenshot or contact hotel:\n📞 ${HOTEL_INFO.phone}`
    );
    await sendMessage(from, `✅ Payment rejected for ${pending.guestName}`);
    return;
  }

  // APPROVE CANCEL <voucherNo>
  if (t.startsWith("APPROVE CANCEL ")) {
    const voucherNo = t.split(" ")[2];
    const cancel = pendingCancellations[voucherNo];
    if (!cancel) { await sendMessage(from, `❌ No pending cancellation for ${voucherNo}`); return; }
    if (cancel.stayezeeId) await cancelReservation(cancel.stayezeeId);
    await sendMessage(cancel.guestPhone,
      `✅ *Booking Cancelled*\n\n` +
      `Voucher: *${voucherNo}*\n` +
      `Guest: ${cancel.guestName}\n\n` +
      `${cancel.refundAmount > 0 ? `Refund: Rs.${cancel.refundAmount.toLocaleString()} will be processed.` : "No refund as per cancellation policy."}\n\n` +
      `We hope to serve you again! 🙏`
    );
    delete pendingCancellations[voucherNo];
    await sendMessage(from, `✅ Cancellation approved for ${voucherNo}`);
    return;
  }

  // REJECT CANCEL <voucherNo>
  if (t.startsWith("REJECT CANCEL ")) {
    const voucherNo = t.split(" ")[2];
    const cancel = pendingCancellations[voucherNo];
    if (!cancel) { await sendMessage(from, `❌ Not found: ${voucherNo}`); return; }
    await sendMessage(cancel.guestPhone,
      `❌ *Cancellation Not Approved*\n\n` +
      `Voucher: *${voucherNo}*\n\n` +
      `Please contact hotel directly:\n📞 ${HOTEL_INFO.phone}`
    );
    delete pendingCancellations[voucherNo];
    await sendMessage(from, `✅ Cancellation rejected for ${voucherNo}`);
    return;
  }

  // STATUS — show pending bookings
  if (t === "STATUS" || t === "PENDING") {
    const pp = Object.entries(pendingPayments);
    if (pp.length === 0) { await sendMessage(from, `📋 No pending payments.`); return; }
    const lines = pp.map(([ph, p]) =>
      `• ${p.guestName} (${ph})\n  Voucher: ${p.voucherNo}\n  CI: ${fmtDate(p.ciDate)} | Rs.${p.total.toLocaleString()}`
    );
    await sendMessage(from, `📋 *Pending Payments (${pp.length}):*\n\n${lines.join("\n\n")}`);
    return;
  }

  await sendMessage(from,
    `*Admin Commands:*\n` +
    `APPROVE PAY <phone> <amount>\n` +
    `REJECT PAY <phone>\n` +
    `APPROVE CANCEL <voucherNo>\n` +
    `REJECT CANCEL <voucherNo>\n` +
    `STATUS — pending payments`
  );
}

// ── USER HANDLER ─────────────────────────────────────────────────────────────
async function handleUser(from, text, t, msgType) {
  const session = sessions[from] || { step: "idle" };
  sessions[from] = session;

  // CANCEL command
  if (t === "CANCEL" || t === "CANCEL BOOKING") {
    const myBookings = Object.values(pendingPayments).filter(p => p.guestPhone === from || p.guestPhone === from);
    const sessionBooking = session.voucherNo ? pendingPayments[Object.keys(pendingPayments).find(k => pendingPayments[k].voucherNo === session.voucherNo)] : null;
    const booking = sessionBooking || myBookings[0];

    if (!booking) {
      await sendMessage(from, `❌ No active booking found to cancel.\n\nFor help: 📞 ${HOTEL_INFO.phone}`);
      return;
    }
    session.step = "awaiting_cancel_confirm";
    session.cancelVoucherNo = booking.voucherNo;
    const daysLeft = Math.round((new Date(booking.ciDate) - new Date()) / 86400000);
    await sendMessage(from,
      `❌ *Cancel Booking?*\n\n` +
      `Voucher: *${booking.voucherNo}*\n` +
      `Guest: ${booking.guestName}\n` +
      `Check-in: ${fmtDate(booking.ciDate)}\n` +
      `Check-out: ${fmtDate(booking.coDate)}\n\n` +
      `⚠️ *Cancellation Policy:*\n` +
      `${daysLeft > 15 ? "✅ Full refund (>15 days)" : "❌ No refund (<15 days)"}\n\n` +
      `Reply *YES* to request cancellation or *NO* to keep booking.`
    );
    return;
  }

  // Awaiting cancel confirm
  if (session.step === "awaiting_cancel_confirm") {
    if (["YES","Y"].includes(t)) {
      const voucherNo = session.cancelVoucherNo;
      const bookingEntry = Object.entries(pendingPayments).find(([,b]) => b.voucherNo === voucherNo);
      const booking = bookingEntry ? bookingEntry[1] : null;
      const daysLeft = booking ? Math.round((new Date(booking.ciDate) - new Date()) / 86400000) : 0;
      const refund = daysLeft > 15 ? (booking?.paidSoFar || 0) : 0;

      pendingCancellations[voucherNo] = {
        guestPhone: from,
        guestName: booking?.guestName || "Guest",
        ciDate: booking?.ciDate, coDate: booking?.coDate,
        voucherNo, refundAmount: refund,
        stayezeeId: booking?.stayezeeId,
      };

      await sendMessage(from,
        `✅ *Cancellation request submitted.*\n\nVoucher: *${voucherNo}*\n\nPending admin approval. We'll notify you shortly. 🙏`
      );
      await sendReminder(ADMIN_PHONE,
        `❌ *CANCELLATION REQUEST*\n\nGuest: ${booking?.guestName} (${from})\nVoucher: *${voucherNo}*\nCheck-in: ${fmtDate(booking?.ciDate)}\nRefund: ${refund > 0 ? `Rs.${refund.toLocaleString()}` : "None"}\n\nAPPROVE CANCEL ${voucherNo}\nREJECT CANCEL ${voucherNo}`
      );
      session.step = "idle";
    } else {
      await sendMessage(from, `Booking kept active. See you in Manali! 🏔️`);
      session.step = "idle";
    }
    return;
  }

  // Awaiting guest name
  if (session.step === "awaiting_guest_name") {
    session.guestName = text.trim();
    session.step = "awaiting_guest_mobile";
    await sendMessage(from, `Thanks! Please share the *guest mobile number*:\n\nExample: *919876543210*`);
    return;
  }

  // Awaiting guest mobile
  if (session.step === "awaiting_guest_mobile") {
    const mobile = text.replace(/\D/g, "");
    session.guestMobile = mobile.startsWith("91") ? mobile : "91" + mobile;
    session.step = "idle";
    await confirmAndSave(from, session);
    return;
  }

  // Awaiting checkout date
  if (session.step === "awaiting_checkout") {
    const parsed = parseEnquiry("dlx " + text);
    if (parsed?.ciDate) {
      session.coDate = parsed.ciDate;
      session.step = "idle";
      if (!session.plan) {
        session.step = "awaiting_plan";
        await sendMessage(from, `Got it! Now what *meal plan*?\n\n*CP* - With Breakfast\n*MAP* - Breakfast + Dinner\n*EP* - Room only`);
      } else {
        await checkAndRespond(from, session);
      }
    } else {
      await sendMessage(from, `Please share the *check-out date*.\nExample: *12 July*`);
    }
    return;
  }

  // Awaiting plan
  if (session.step === "awaiting_plan") {
    const planInput = t.trim();
    if (["CP","MAP","MAPAI","EP"].includes(planInput)) {
      session.plan = planInput;
      session.step = "idle";
      await checkAndRespond(from, session);
    } else {
      await sendMessage(from, `Please reply with:\n*CP* - With Breakfast\n*MAP* - Breakfast + Dinner\n*EP* - Room only`);
    }
    return;
  }

  // Awaiting confirm (YES/NO + upgrades)
  if (session.step === "awaiting_confirm") {
    if (["SUPER","SUPERDELUXE","SUPER DELUXE","SD","SDX","SDLX"].includes(t)) {
      session.roomType = "superdeluxe";
      session.roomTypes = [{ type: "superdeluxe", count: session.rooms }];
      await checkAndRespond(from, session);
      return;
    }
    if (["HONEY","HONEYMOON","HM","HON"].includes(t)) {
      session.roomType = "honeymoon";
      session.roomTypes = [{ type: "honeymoon", count: session.rooms }];
      await checkAndRespond(from, session);
      return;
    }
    if (["DELUXE","DLX","DEL"].includes(t)) {
      session.roomType = "deluxe";
      session.roomTypes = [{ type: "deluxe", count: session.rooms }];
      await checkAndRespond(from, session);
      return;
    }
    if (["YES","Y","CONFIRM","OK","HAAN"].includes(t)) {
      if (session.timeoutId) { clearTimeout(session.timeoutId); session.timeoutId = null; }
      if (session.reminderIds) { session.reminderIds.forEach(id => clearTimeout(id)); session.reminderIds = []; }
      // Re-verify availability
      await sendMessage(from, `Verifying room availability...`);
      try {
        const recheck = await checkAvailability({ ciDate: session.ciDate, coDate: session.coDate, rooms: session.rooms || 1 });
        if (!recheck.available) {
          session.step = "idle";
          await sendMessage(from, `Sorry! Those rooms were just taken.\n\nPlease try different dates. 🙏`);
          return;
        }
      } catch(e) { /* continue */ }
      session.step = "awaiting_guest_name";
      await sendMessage(from, `Please share the *guest full name*:`);
      return;
    }
    if (["NO","N","CANCEL","NAHI"].includes(t)) {
      if (session.timeoutId) { clearTimeout(session.timeoutId); session.timeoutId = null; }
      if (session.reminderIds) { session.reminderIds.forEach(id => clearTimeout(id)); session.reminderIds = []; }
      session.step = "idle";
      await sendMessage(from, `No problem! Feel free to enquire again anytime. 🙏`);
      return;
    }
  }

  // MENU / HELP
  if (["MENU","0","HELP","HI","HELLO","START","HAI","HEY"].includes(t)) {
    await sendWelcomeMenu(from);
    return;
  }

  if (t === "1") { await sendWelcomeMenu(from); return; }

  if (t === "2") {
    await sendMessage(from,
      `📍 *${HOTEL_INFO.name}*\n${HOTEL_INFO.location}\n\n` +
      `Google Maps: ${HOTEL_INFO.googleMaps}\n\n` +
      `Check-in: ${HOTEL_INFO.checkIn}\n` +
      `Check-out: ${HOTEL_INFO.checkOut}\n\n` +
      `Reply *0* for menu.`
    );
    return;
  }

  if (t === "3") {
    const { FLAT_RATES } = require("./rates");
    await sendMessage(from,
      `🏨 *Room Rates — ${HOTEL_INFO.name}*\n\n` +
      `🛏 *Deluxe* — Rs.${FLAT_RATES.deluxe.toLocaleString()}/night\n` +
      `🛏 *Super Deluxe* — Rs.${FLAT_RATES.superdeluxe.toLocaleString()}/night\n` +
      `🛏 *Honeymoon* — Rs.${FLAT_RATES.honeymoon.toLocaleString()}/night\n\n` +
      `*Meal Plans:*\n` +
      `CP - With Breakfast\n` +
      `MAP - Breakfast + Dinner\n` +
      `EP - Room only\n\n` +
      `_Rates are per room per night._\n\n` +
      `Reply *0* for menu.`
    );
    return;
  }

  if (t === "4") {
    await sendMessage(from,
      `📞 *Contact Us*\n\n` +
      `Hotel: ${HOTEL_INFO.name}\n` +
      `Phone: ${HOTEL_INFO.phone}\n` +
      `Location: ${HOTEL_INFO.location}\n\n` +
      `Reply *0* for menu.`
    );
    return;
  }

  // Try to parse as enquiry
  const enquiry = parseEnquiry(text);
  if (enquiry) {
    session.ciDate   = enquiry.ciDate;
    session.coDate   = enquiry.coDate;
    session.rooms    = enquiry.rooms || 1;
    session.roomType = enquiry.roomType || "deluxe";
    session.roomTypes = enquiry.roomTypes || null;
    if (enquiry.plan) session.plan = enquiry.plan;

    // Validate future date
    const today = new Date(); today.setHours(0,0,0,0);
    if (new Date(session.ciDate) < today) {
      await sendMessage(from, `Check-in date *${fmtDate(session.ciDate)}* is in the past. Please send a future date.`);
      return;
    }

    // Ack
    await sendMessage(from,
      `Thanks for your enquiry! 😊\n\n` +
      `Check-in: ${fmtDate(session.ciDate)}\n` +
      `Check-out: ${session.coDate ? fmtDate(session.coDate) : "—"}\n` +
      `Rooms: ${session.rooms}\n` +
      `Plan: ${session.plan || "—"}\n\n` +
      `Checking availability...`
    );

    if (!session.coDate) {
      session.step = "awaiting_checkout";
      await sendMessage(from, `Please share the *check-out date*.\nExample: *12 July*`);
      return;
    }
    if (!session.plan) {
      session.step = "awaiting_plan";
      await sendMessage(from, `What *meal plan*?\n\n*CP* - With Breakfast\n*MAP* - Breakfast + Dinner\n*EP* - Room only`);
      return;
    }
    await checkAndRespond(from, session);
    return;
  }

  // Partial session fill-in
  if (session.ciDate && !session.coDate) {
    const parsed = parseEnquiry("dlx " + text);
    if (parsed?.ciDate) {
      session.coDate = parsed.ciDate;
      if (!session.plan) {
        session.step = "awaiting_plan";
        await sendMessage(from, `Got it! What *meal plan*?\n*CP* / *MAP* / *EP*`);
      } else { await checkAndRespond(from, session); }
      return;
    }
  }
  if (session.ciDate && session.coDate && !session.plan) {
    if (["CP","MAP","MAPAI","EP"].includes(t)) {
      session.plan = t;
      await checkAndRespond(from, session);
      return;
    }
  }

  // Default
  await sendWelcomeMenu(from);
}

// ── WELCOME MENU ─────────────────────────────────────────────────────────────
async function sendWelcomeMenu(from) {
  await sendMessage(from,
    `🏔️ *Welcome to ${HOTEL_INFO.name}, ${HOTEL_INFO.location}!*\n\n` +
    `To check room availability, just send your enquiry like:\n\n` +
    `_2 deluxe CP 10 july 12 july_\n` +
    `_1 honeymoon MAP 15 aug 17 aug_\n\n` +
    `Or choose an option:\n\n` +
    `*2* - 📍 Location & directions\n` +
    `*3* - 💰 Room rates\n` +
    `*4* - 📞 Contact us\n` +
    `*CANCEL* - Cancel a booking\n\n` +
    `_Reply 0 anytime to see this menu._`
  );
}

// ── CHECK AVAILABILITY AND SEND RATE QUOTE ───────────────────────────────────
async function checkAndRespond(from, session) {
  try {
    const nights = calcNights(session.ciDate, session.coDate);
    session.nights = nights;

    if (nights <= 0) {
      await sendMessage(from, `Check-out must be after check-in. Please try again.`);
      session.step = "idle";
      return;
    }

    const result = await checkAvailability({
      ciDate: session.ciDate,
      coDate: session.coDate,
      rooms: session.rooms || 1,
    });

    if (result.available) {
      session.step = "awaiting_confirm";
      const plan = session.plan;

      const roomTypesList = session.roomTypes && session.roomTypes.length > 1
        ? session.roomTypes
        : [{ type: session.roomType || "deluxe", count: session.rooms }];

      let msg = `✅ *Rooms Available!*\n\n`;
      let grandTotal = 0;

      for (const rt of roomTypesList) {
        const info = getRate(rt.type);
        const rate = info?.rate || 0;
        const roomTotal = rate * rt.count * nights;
        grandTotal += roomTotal;
        msg += `*${rt.count} x ${info?.roomType || rt.type}*\n`;
        msg += `  Rate: *Rs.${rate.toLocaleString()}/night*\n\n`;
      }

      msg += `📅 Check-in:  *${fmtDate(session.ciDate)}*\n`;
      msg += `📅 Check-out: *${fmtDate(session.coDate)}*\n`;
      msg += `🌙 Nights: *${nights}*\n`;
      msg += `🍽 Plan: *${plan}*\n`;
      msg += `💰 Total: *Rs.${Math.round(grandTotal).toLocaleString()}*\n\n`;

      // Upgrade options
      const currentType = (session.roomTypes?.[0]?.type || session.roomType || "deluxe").toLowerCase();
      if (!currentType.includes("honey")) {
        const { FLAT_RATES } = require("./rates");
        msg += `🔼 *Upgrade options:*\n`;
        if (!currentType.includes("super")) {
          msg += `  Reply *SUPER* → Super Deluxe (Rs.${FLAT_RATES.superdeluxe.toLocaleString()}/night)\n`;
        }
        msg += `  Reply *HONEY* → Honeymoon (Rs.${FLAT_RATES.honeymoon.toLocaleString()}/night)\n\n`;
      }

      msg += `Reply *YES* to confirm or *NO* to cancel.\n\n`;
      msg += `📍 ${HOTEL_INFO.googleMaps}`;

      session.totalAmount = Math.round(grandTotal);
      await sendMessage(from, msg);

      // Follow-up reminders
      if (session.timeoutId) clearTimeout(session.timeoutId);
      if (session.reminderIds) session.reminderIds.forEach(id => clearTimeout(id));
      session.reminderIds = [];

      const enquirySummary = `CI: ${fmtDate(session.ciDate)} | CO: ${fmtDate(session.coDate)} | ${session.rooms}R | ${plan} | Rs.${Math.round(grandTotal).toLocaleString()}`;

      [24, 48, 72].forEach((hrs, idx) => {
        const id = setTimeout(async () => {
          if (sessions[from]?.step !== "awaiting_confirm") return;
          await sendMessage(from,
            `👋 Following up on your enquiry!\n\n${enquirySummary}\n\nRooms still available. Reply *YES* to confirm or *NO* to cancel.`
          );
        }, hrs * 60 * 60 * 1000);
        session.reminderIds.push(id);
      });

      // Auto-cancel after 1 week
      const finalId = setTimeout(async () => {
        if (sessions[from]?.step !== "awaiting_confirm") return;
        sessions[from].step = "idle";
        await sendMessage(from, `Your enquiry has been auto-cancelled after 1 week. Send a new enquiry anytime. 🙏`);
        await sendReminder(ADMIN_PHONE, `⚠️ AUTO-CANCELLED\n${from}\n${enquirySummary}`);
      }, 7 * 24 * 60 * 60 * 1000);
      session.reminderIds.push(finalId);

      await sendReminder(ADMIN_PHONE,
        `✅ *AVAILABLE*\nFrom: ${from}\n${enquirySummary}\nAwaiting confirmation.`
      );

    } else if (result.available === false) {
      session.step = "idle";
      await sendMessage(from,
        `❌ Sorry, rooms not available for:\n\n` +
        `Check-in:  *${fmtDate(session.ciDate)}*\n` +
        `Check-out: *${fmtDate(session.coDate)}*\n` +
        `Rooms: *${session.rooms}*\n\n` +
        `Please try different dates. 🙏\n\n` +
        `Contact us: 📞 ${HOTEL_INFO.phone}`
      );
    } else {
      // PMS error — still respond helpfully
      session.step = "idle";
      await sendMessage(from,
        `⚠️ Could not check availability right now.\n\n` +
        `Please contact us directly:\n📞 ${HOTEL_INFO.phone}`
      );
      await sendReminder(ADMIN_PHONE,
        `⚠️ PMS ERROR\nFrom: ${from}\nCI: ${session.ciDate} CO: ${session.coDate}\nError: ${result.error || "unknown"}`
      );
    }
  } catch (err) {
    console.error("checkAndRespond error:", err.message);
    await sendMessage(from, `Sorry, there was an error. Please try again or contact: 📞 ${HOTEL_INFO.phone}`);
  }
}

// ── CONFIRM AND SAVE TO STAYEZEE ─────────────────────────────────────────────
async function confirmAndSave(from, session) {
  try {
    const voucherNo = genVoucher();
    session.voucherNo = voucherNo;

    const pmsRoomType = session.roomType === "honeymoon" ? "Honeymoon" :
                        session.roomType === "superdeluxe" ? "Super Deluxe" : "Deluxe";

    const stayRes = await saveReservation({
      guestName:    session.guestName,
      guestMobile:  session.guestMobile || from,
      male: 1, female: 0, kids: 0,
      plan:         session.plan || "EP",
      tariff:       session.totalAmount || 0,
      rooms:        session.rooms || 1,
      checkinDate:  session.ciDate,
      checkoutDate: session.coDate,
      roomType:     pmsRoomType,
    });

    const stayezeeId = stayRes?.data?.reservation_id || stayRes?.data?.id || null;
    const advance = Math.round((session.totalAmount || 0) * 0.3);
    const total = session.totalAmount || 0;

    // Store pending payment
    pendingPayments[from] = {
      voucherNo, guestName: session.guestName,
      guestPhone: from,
      ciDate: session.ciDate, coDate: session.coDate,
      rooms: session.rooms, roomType: session.roomType, plan: session.plan,
      amount: advance, total, paidSoFar: 0,
      stayezeeId,
    };

    const upiLink = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(HOTEL_INFO.name)}&am=${advance}&cu=INR&tn=${voucherNo}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=800x800&ecc=H&margin=2&data=${encodeURIComponent(upiLink)}`;

    // Send confirmation with payment QR
    const axios = require("axios");
    try {
      await axios.post(
        `https://graph.facebook.com/v25.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp", recipient_type: "individual", to: from,
          type: "image",
          image: {
            link: qrUrl,
            caption:
              `🎉 *Booking Confirmed!*\n\n` +
              `Voucher: *${voucherNo}*\n` +
              `Guest: ${session.guestName}\n` +
              `Check-in: *${fmtDate(session.ciDate)}* at ${HOTEL_INFO.checkIn}\n` +
              `Check-out: *${fmtDate(session.coDate)}* at ${HOTEL_INFO.checkOut}\n` +
              `Rooms: ${session.rooms} x ${pmsRoomType}\n` +
              `Plan: ${session.plan}\n` +
              `Total: Rs.${total.toLocaleString()}\n\n` +
              `💳 *Pay 30% Advance: Rs.${advance.toLocaleString()}*\n` +
              `UPI: *${UPI_ID}*\n\n` +
              `📸 Send payment screenshot to confirm.\n\n` +
              `📍 ${HOTEL_INFO.googleMaps}`
          }
        },
        { headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
      );
    } catch (e) {
      // Fallback to text if image fails
      await sendMessage(from,
        `🎉 *Booking Confirmed!*\n\n` +
        `Voucher: *${voucherNo}*\n` +
        `Guest: ${session.guestName}\n` +
        `Check-in: *${fmtDate(session.ciDate)}*\n` +
        `Check-out: *${fmtDate(session.coDate)}*\n` +
        `Rooms: ${session.rooms} x ${pmsRoomType}\n` +
        `Plan: ${session.plan}\n` +
        `Total: Rs.${total.toLocaleString()}\n\n` +
        `💳 Pay 30% advance: *Rs.${advance.toLocaleString()}*\n` +
        `UPI ID: *${UPI_ID}*\n\n` +
        `📸 Send payment screenshot.\n\n` +
        `📍 ${HOTEL_INFO.googleMaps}`
      );
    }

    // Notify admin
    await sendReminder(ADMIN_PHONE,
      `🎉 *NEW BOOKING*\n\n` +
      `Voucher: *${voucherNo}*\n` +
      `Guest: ${session.guestName} (${from})\n` +
      `CI: ${fmtDate(session.ciDate)} → CO: ${fmtDate(session.coDate)}\n` +
      `${session.rooms} x ${pmsRoomType} | ${session.plan}\n` +
      `Total: Rs.${total.toLocaleString()}\n` +
      `Advance due: Rs.${advance.toLocaleString()}\n` +
      `PMS ID: ${stayezeeId || "—"}`
    );

    session.step = "idle";
  } catch (err) {
    console.error("confirmAndSave error:", err.message);
    await sendMessage(from, `Sorry, there was an error saving your booking. Please contact: 📞 ${HOTEL_INFO.phone}`);
  }
}

module.exports = { handleIncoming };
