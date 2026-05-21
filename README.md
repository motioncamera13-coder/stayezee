# Stayezee Manali — WhatsApp Bot

WhatsApp booking bot for **Stayezee, Manali**.  
Open to all guests — no agent system.

## Quick Start

```bash
npm install
npm start
```

## Environment (.env)

| Variable | Value |
|---|---|
| WA_PHONE_NUMBER_ID | 1151755318021275 |
| WA_ACCESS_TOKEN | (set in .env) |
| VERIFY_TOKEN | stayezee_manali_verify_2024 |
| ADMIN_PHONE | 919116091107 |
| STAYEZEE_CUSTOMER_ID | demohotel |
| STAYEZEE_USERNAME | admin |
| STAYEZEE_PASSWORD | 87654321 |
| HOTEL_NAME | Stayezee |
| HOTEL_LOCATION | Manali, Himachal Pradesh |
| RATE_DELUXE | 2000 |
| RATE_SUPERDELUXE | 3000 |
| RATE_HONEYMOON | 4000 |

## Room Rates

| Room Type | Rate/Night |
|---|---|
| Deluxe | Rs. 2,000 |
| Super Deluxe | Rs. 3,000 |
| Honeymoon | Rs. 4,000 |

*Flat rates — no peak/off season. Same for all guests.*

## Webhook Setup (Meta)

- Callback URL: `https://your-server.com/webhook`
- Verify token: `stayezee_manali_verify_2024`

## Admin Commands (send via WhatsApp to 9116091107)

| Command | Action |
|---|---|
| `APPROVE PAY <phone> <amount>` | Confirm payment |
| `REJECT PAY <phone>` | Reject payment screenshot |
| `APPROVE CANCEL <voucherNo>` | Approve cancellation |
| `REJECT CANCEL <voucherNo>` | Reject cancellation |
| `STATUS` | See all pending payments |

## Sample Enquiries (what guests send)

```
2 deluxe CP 10 july 12 july
1 honeymoon MAP 15 aug 17 aug 4 adults
super deluxe 2 rooms EP 5 sept 8 sept
```

## Files

```
src/
  server.js    — Express webhook server
  handler.js   — Main bot logic
  stayezee.js  — Stayezee PMS integration
  rates.js     — Room rates
  parser.js    — Enquiry text parser
  whatsapp.js  — WhatsApp API sender
```
