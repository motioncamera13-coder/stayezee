"use strict";

// Shared enquiry log — stores all new enquiries for 15-min admin digest
const enquiryLog = [];

function addToLog({ phone, name, status, dates, rooms }) {
  // Avoid duplicates — update if phone already exists
  const existing = enquiryLog.find(e => e.phone === phone);
  if (existing) {
    existing.status = status || existing.status;
    existing.name   = name   || existing.name;
    existing.dates  = dates  || existing.dates;
    existing.rooms  = rooms  || existing.rooms;
    existing.time   = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
  } else {
    enquiryLog.push({
      phone,
      name:   name   || "Unknown",
      status: status || "Enquiry",
      dates:  dates  || null,
      rooms:  rooms  || null,
      time:   new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
    });
  }
}

function getEnquiryLog() {
  return [...enquiryLog];
}

function clearEnquiryLog() {
  enquiryLog.length = 0;
}

module.exports = { addToLog, getEnquiryLog, clearEnquiryLog };
