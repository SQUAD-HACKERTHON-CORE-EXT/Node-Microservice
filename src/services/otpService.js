import redis from '../config/redis.js';
import { sendEmail } from './emailService.js';

const OTP_TTL = 5 * 60;

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function requestOTP(email) {
  const otp = generateOTP();
  const key = `otp:${email}`;

  await redis.set(key, otp, 'EX', OTP_TTL);

  await sendEmail(
    email,
    'Your Kolliq Verification Code',
    `
      <div style="font-family: Arial, sans-serif; max-width: 400px; margin: auto;">
        <h2 style="color: #1B4F9C;">Kolliq Verification</h2>
        <p>Your verification code is:</p>
        <h1 style="letter-spacing: 8px; color: #1B4F9C;">${otp}</h1>
        <p>Valid for <strong>5 minutes</strong>. Do not share it with anyone.</p>
        <p style="color: #888; font-size: 12px;">If you didn't request this, ignore this email.</p>
      </div>
    `
  );

  return { message: 'OTP sent to your email' };
}

export async function verifyOTP(email, otp) {
  // demo bypass
  if (process.env.NODE_ENV === 'development' && otp === '000000') {
    return true;
  }

  const key = `otp:${email}`;
  const stored = await redis.get(key);

  if (!stored) throw new Error('OTP expired or not found');
  if (stored !== otp) throw new Error('Invalid OTP');

  await redis.del(key);
  return true;
}