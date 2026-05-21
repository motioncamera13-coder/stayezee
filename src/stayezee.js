"use strict";
const axios = require("axios");
const FormData = require("form-data");

const API_BASE = "https://india.stayezeepms.co.in/FO/API";
const HOTEL_ID = process.env.STAYEZEE_CUSTOMER_ID || "demohotel";
const BUFFER_ROOMS = parseInt(process.env.BUFFER_ROOMS || "2");

async function checkAvailability({ ciDate, coDate, rooms }) {
  console.log(`🔍 Stayezee availability: ${ciDate} → ${coDate}, ${rooms} rooms`);
  try {
    const form = new FormData();
    form.append("checkin_date", ciDate);
    form.append("checkout_date", coDate);
    form.append("rooms_required", String(parseInt(rooms) + BUFFER_ROOMS));

    const res = await axios.post(`${API_BASE}/roomAvailability`, form, {
      headers: { "X-Hotel-ID": HOTEL_ID, ...form.getHeaders() },
      timeout: 15000,
    });

    console.log("✓ Stayezee response:", JSON.stringify(res.data));
    const d = res.data;
    if (d.status === true || d.message === "Rooms available") {
      return { available: true, availableRooms: parseInt(rooms) };
    }
    return { available: false, availableRooms: 0 };
  } catch (err) {
    console.error("✗ Stayezee availability error:", err.response?.data || err.message);
    return { available: null, error: err.message };
  }
}

async function saveReservation({ guestName, guestMobile, male, female, kids, plan, tariff, rooms, checkinDate, checkoutDate, roomType }) {
  console.log("Saving reservation:", guestName, checkinDate, checkoutDate);
  try {
    const form = new FormData();
    form.append("guest_name", guestName || "Guest");
    form.append("guest_mobile", guestMobile || "");
    form.append("male", String(male || 1));
    form.append("female", String(female || 0));
    form.append("kids", String(kids || 0));
    form.append("plan", plan || "EP");
    form.append("tariff", String(tariff || 0));
    form.append("rooms", String(rooms || 1));
    form.append("checkin_date", checkinDate);
    form.append("checkout_date", checkoutDate);
    form.append("room_type", roomType || "Deluxe");

    const res = await axios.post(`${API_BASE}/saveReservation`, form, {
      headers: { "X-Hotel-ID": HOTEL_ID, ...form.getHeaders() },
      timeout: 15000,
    });

    console.log("Stayezee save response:", JSON.stringify(res.data));
    if (res.data?.status === false || res.data?.success === false) {
      return { success: false, data: res.data, error: res.data?.message || "Stayezee rejected reservation" };
    }
    return { success: true, data: res.data };
  } catch (err) {
    console.error("Stayezee save error:", err.response?.data || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

async function cancelReservation(reservationId) {
  console.log("Cancelling reservation:", reservationId);
  try {
    const form = new FormData();
    form.append("reservation_id", String(reservationId));
    form.append("cancel_reason", "Cancelled by guest via WhatsApp bot");

    const res = await axios.post(`${API_BASE}/cancelReservation`, form, {
      headers: { "X-Hotel-ID": HOTEL_ID, ...form.getHeaders() },
      timeout: 15000,
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error("Stayezee cancel error:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { checkAvailability, saveReservation, cancelReservation };
