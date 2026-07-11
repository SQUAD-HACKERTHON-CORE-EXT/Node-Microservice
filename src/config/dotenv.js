import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const config = {

    PORT:process.env.PORT,
    NODE_ENV:process.env.NODE_ENV,
    REDIS_URL:process.env.REDIS_URL,
    AT_API_KEY:process.env.AT_API_KEY,
    AT_USERNAME:process.env.AT_USERNAME,   
    AT_SENDER_ID:process.env.AT_SENDER_ID,
    DJANGO_API_SECRET:process.env.DJANGO_API_SECRET,
    DJANGO_API_URL:process.env.DJANGO_API_URL,
    SQUAD_WEBHOOK_SECRET:process.env.SQUAD_WEBHOOK_SECRET,
    SQUAD_SECRET_KEY:process.env.SQUAD_SECRET_KEY,
    SQUAD_PUBLIC_KEY:process.env.SQUAD_PUBLIC_KEY,
    SQUAD_BASE_URL:process.env.SQUAD_BASE_URL,
    OTP_TTL_SECONDS:process.env.OTP_TTL_SECONDS,
    OTP_LENGTH:process.env.OTP_LENGTH,
    TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN,
    TWILIO_ACCOUNT_SID:process.env.TWILIO_ACCOUNT_SID,
    ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY,
    TWILIO_WHATSAPP_NUMBER:process.env.TWILIO_WHATSAPP_NUMBER,
    WEBHOOK_SECRET:process.env.WEBHOOK_SECRET,
    GROQ_API_KEY:process.env.GROQ_API_KEY,
    JWT_SECRET:process.env.JWT_SECRET,
    GMAIL_USER:process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD:process.env.GMAIL_APP_PASSWORD,    



}
export default config