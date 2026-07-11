import nodemailer from 'nodemailer';
import config from '../config/dotenv.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.GMAIL_USER,
    pass: config.GMAIL_APP_PASSWORD,
  },
});

export async function sendEmail(to, subject, body) {
  const result = await transporter.sendMail({
    from: `"Kolliq" <${config.GMAIL_USER}>`,
    to,
    subject,
    html: body,
  });
  return result;
}