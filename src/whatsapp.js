const axios = require("axios");

const BASE_URL        = "https://graph.facebook.com/v25.0";
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.WA_ACCESS_TOKEN;

async function sendMessage(to, text) {
  const toNum = to.replace(/^\+/, "");
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.log(`[MOCK] To: ${toNum}\n${text}`);
    return;
  }
  try {
    const res = await axios.post(
      `${BASE_URL}/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", recipient_type: "individual", to: toNum, type: "text", text: { body: text, preview_url: false } },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`✓ Text sent to ${toNum}`);
    return res.data;
  } catch (err) {
    console.error(`✗ Failed to send to ${toNum}:`, JSON.stringify(err.response?.data || err.message));
  }
}

// Supports named variables: { guest_name: "Rahul", booking_no: "CNR2" }
// Sends as: [{ type: "text", parameter_name: "guest_name", text: "Rahul" }, ...]
async function sendTemplate(to, templateName, params = []) {
  const toNum = to.replace(/^\+/, "");
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.log(`[MOCK TEMPLATE] To: ${toNum} | ${templateName} | Params:`, params);
    return;
  }

  let parameters = [];
  if (Array.isArray(params)) {
    // Positional array
    parameters = params.map(p => ({ type: "text", text: String(p) }));
  } else if (typeof params === "object") {
    // Named variables — send as parameter_name + text
    parameters = Object.entries(params).map(([key, val]) => ({
      type: "text",
      parameter_name: key,
      text: String(val)
    }));
  }

  const components = parameters.length > 0
    ? [{ type: "body", parameters }]
    : [];

  try {
    const res = await axios.post(
      `${BASE_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toNum,
        type: "template",
        template: { name: templateName, language: { code: "en" }, components }
      },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`✓ Template "${templateName}" sent to ${toNum}`);
    return res.data;
  } catch (err) {
    console.error(`✗ Failed template "${templateName}" to ${toNum}:`, JSON.stringify(err.response?.data || err.message));
  }
}

async function sendReminder(to, text) {
  return sendMessage(to, text);
}

module.exports = { sendMessage, sendTemplate, sendReminder };
