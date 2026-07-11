import crypto from "crypto";
import axios from "axios";
import redis from "../config/redis.js";
import { sendSMS } from "../services/emailService.js";
import { queueFailedCall } from "../services/retryQueue.js";
import config from "../config/dotenv.js";

function verifySquadSignature(rawBody, signature) {
  const hash = crypto
    .createHmac("sha512", config.SQUAD_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex")
    .toUpperCase();
  return hash === signature?.toUpperCase();
}

export async function handleSquadWebhook(req, res) {
  const signature = req.headers["x-squad-encrypted-body"];
  const rawBody = JSON.stringify(req.body);

  if (!verifySquadSignature(rawBody, signature)) {
    console.warn("❌ Invalid Squad webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.body;
  const eventType = event?.Event;
  console.log("📦 Squad webhook:", eventType);

  res.status(200).json({ status: "received" });

  setImmediate(async () => {
    try {
      if (eventType === "virtual_account.credited") {
        const {
          phone_number,
          amount,
          virtual_account_number,
          transaction_reference,
          sender_name,
        } = event?.Body || {};
        const naira = (amount / 100).toFixed(2);
        const payload = {
          phone: phone_number,
          amount,
          account_number: virtual_account_number,
          reference: transaction_reference,
          type: "credit",
          source: "squad_webhook",
          sender_name,
        };

        try {
          await axios.post(
            `${process.env.DJANGO_API_URL}/api/payments/webhook/internal/`,
            payload,
            {
              headers: { "X-Internal-Secret": config.DJANGO_API_SECRET },
              timeout: 8000,
            },
          );
        } catch (err) {
          await queueFailedCall({
            url: `${config.DJANGO_API_URL}/api/payments/webhook/internal/`,
            body: payload,
          });
        }

        await redis.publish(
          "kolliq:payments",
          JSON.stringify({
            event: "payment.credited",
            phone: phone_number,
            amount,
            naira,
            account_number: virtual_account_number,
            reference: transaction_reference,
            timestamp: new Date().toISOString(),
          }),
        );

        if (phone_number) {
          await sendSMS(
            phone_number,
            `✅ Kolliq: You received ₦${naira} from ${sender_name || "a sender"}.\nAcct: ${virtual_account_number}\nRef: ${transaction_reference}\nDial *347*1234# to check balance.`,
          );
        }
      }

      if (eventType === "escrow.released") {
        const { phone_number, amount, transaction_reference } =
          event?.Body || {};
        const naira = (amount / 100).toFixed(2);
        await redis.publish(
          "kolliq:payments",
          JSON.stringify({
            event: "escrow.released",
            phone: phone_number,
            amount,
            naira,
            reference: transaction_reference,
            timestamp: new Date().toISOString(),
          }),
        );
        if (phone_number) {
          await sendSMS(
            phone_number,
            `💰 Kolliq: ₦${naira} released to your wallet. Ref: ${transaction_reference}. Keep it up! 🔥`,
          );
        }
      }
    } catch (err) {
      console.error("Webhook async error:", err.message);
    }
  });
}

export async function handleWhatsAppWebhook(req, res) {
  console.log("WhatsApp delivery webhook:", req.body);
  return res.status(200).json({ status: "received" });
}
