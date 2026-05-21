"use strict";

// Flat rates — no peak/off season, no agent category discounts
// All rates are per room per night (GST inclusive)
const FLAT_RATES = {
  deluxe:      parseInt(process.env.RATE_DELUXE      || "2000"),
  superdeluxe: parseInt(process.env.RATE_SUPERDELUXE || "3000"),
  honeymoon:   parseInt(process.env.RATE_HONEYMOON   || "4000"),
};

const PLANS = ["CP", "MAP", "MAPAI", "EP"];

function normalizeRoomKey(roomType) {
  const r = (roomType || "").toLowerCase().replace(/\s/g, "").replace("-", "");
  if (r.includes("honey")) return "honeymoon";
  if (r.includes("super")) return "superdeluxe";
  return "deluxe";
}

function getRate(roomType) {
  const key = normalizeRoomKey(roomType);
  const rate = FLAT_RATES[key];
  if (!rate) return null;
  return {
    rate,
    roomType: key === "honeymoon" ? "Honeymoon" : key === "superdeluxe" ? "Super Deluxe" : "Deluxe",
  };
}

function parseRoomType(text) {
  const lower = (text || "").toLowerCase();
  if (lower.includes("honey")) return "honeymoon";
  if (lower.includes("super")) return "superdeluxe";
  if (lower.includes("deluxe") || lower.includes("dlx")) return "deluxe";
  return "deluxe";
}

module.exports = { getRate, parseRoomType, FLAT_RATES };
