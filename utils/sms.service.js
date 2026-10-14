const https = require('https');
const { sendEmail } = require('./email.service');

/**
 * Normalize an Indian phone number to its 10-digit core and +91 format.
 */
function normalizePhone(phone) {
  if (!phone) return { digits10: '', e164: '' };
  const digits = String(phone).replace(/\D/g, '');
  const digits10 = digits.length >= 10 ? digits.slice(-10) : digits;
  const e164 = digits10.length === 10 ? `+91${digits10}` : `+${digits}`;
  return { digits10, e164 };
}

/**
 * Build a MongoDB $or query that matches a user by email OR phone (in any format: 10-digit, +91, 91, 0-prefixed).
 */
function buildIdentifierQuery(rawInput) {
  const clean = String(rawInput || '').trim();
  const lower = clean.toLowerCase();
  const digits = clean.replace(/\D/g, '');
  const digits10 = digits.length >= 10 ? digits.slice(-10) : '';

  const orConditions = [
    { email: lower },
    { phone: clean },
  ];

  if (digits10.length === 10) {
    orConditions.push(
      { phone: digits10 },
      { phone: `+91${digits10}` },
      { phone: `+91 ${digits10}` },
      { phone: `91${digits10}` },
      { phone: `0${digits10}` },
      { phone: { $regex: `${digits10}$` } }
    );
  }

  return { $or: orConditions };
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone) {
  const { digits10 } = normalizePhone(phone);
  if (!digits10 || digits10.length < 4) return '';
  return `+91 ******${digits10.slice(-4)}`;
}

/**
 * Helper to perform GET/POST HTTPS requests without external dependencies.
 */
function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('SMS request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Send OTP via SMS using 2Factor.in (primary) or Twilio fallback.
 * Sends the EXACT same 6-digit OTP that is emailed to the user.
 */
async function sendSmsOTP(phone, otp) {
  const { digits10, e164 } = normalizePhone(phone);
  if (!digits10 || digits10.length < 10) {
    console.warn(`⚠️ [SMS OTP] User has no valid 10-digit phone number (${phone}). Skipping SMS.`);
    return { sent: false, reason: 'invalid_phone' };
  }

  console.log(`📱 [SMS OTP] Preparing OTP ${otp} for phone ${e164}`);

  // 1. Primary: 2Factor.in API (https://2factor.in)
  const twoFactorKey = (process.env.TWOFACTOR_API_KEY || 'c6a53efd-c7e3-11f1-af74-0200cd936042').trim();
  if (twoFactorKey && twoFactorKey !== 'YOUR_2FACTOR_API_KEY_HERE') {
    try {
      const url = `https://2factor.in/API/V1/${encodeURIComponent(twoFactorKey)}/SMS/${digits10}/${encodeURIComponent(otp)}`;
      const res = await httpsRequest(url, { method: 'GET' });
      const parsed = JSON.parse(res.body || '{}');
      if (res.statusCode >= 200 && res.statusCode < 300 && parsed.Status === 'Success') {
        console.log(`✅ [2Factor SMS Sent] To: ${e164} | Session: ${parsed.Details}`);
        return { sent: true, provider: '2factor' };
      }
      console.warn(`⚠️ [2Factor SMS Warning] Status: ${res.statusCode} | Response: ${res.body}`);
    } catch (err) {
      console.error(`❌ [2Factor SMS Error] ${err.message}`);
    }
  } else {
    console.log(`ℹ️ [SMS OTP] TWOFACTOR_API_KEY not set yet in .env. OTP for ${e164} is: ${otp}`);
  }

  // 2. Fallback: Fast2SMS if FAST2SMS_API_KEY is configured
  const fast2SmsKey = (process.env.FAST2SMS_API_KEY || '').trim();
  if (fast2SmsKey) {
    try {
      const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(fast2SmsKey)}&route=otp&variables_values=${encodeURIComponent(otp)}&flash=0&numbers=${digits10}`;
      const res = await httpsRequest(url, { method: 'GET' });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`✅ [Fast2SMS Sent] To: ${e164}`);
        return { sent: true, provider: 'fast2sms' };
      }
    } catch (err) {
      console.warn(`⚠️ [Fast2SMS Error] ${err.message}`);
    }
  }

  // 3. Fallback: Twilio if TWILIO_SID and TWILIO_AUTH_TOKEN are configured
  const twilioSid = (process.env.TWILIO_SID || '').trim();
  const twilioToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const twilioPhone = (process.env.TWILIO_PHONE || '').trim();
  if (twilioSid && twilioToken && twilioPhone) {
    try {
      const postData = new URLSearchParams({
        To: e164,
        From: twilioPhone,
        Body: `Your Dabba Nation verification OTP is ${otp}. Valid for 10 minutes. Do not share this code.`,
      }).toString();

      const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const res = await httpsRequest(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        postData
      );
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`✅ [Twilio SMS Sent] To: ${e164}`);
        return { sent: true, provider: 'twilio' };
      }
    } catch (err) {
      console.warn(`⚠️ [Twilio SMS Error] ${err.message}`);
    }
  }

  return { sent: false, reason: 'no_active_provider_or_failed' };
}

/**
 * Send the same 6-digit OTP to BOTH the user's Phone (SMS) and Email.
 */
async function sendDualOTP({ user, otp, purpose = 'Login Verification' }) {
  const emailPromise = user?.email
    ? sendEmail({
        to: user.email,
        subject: `${otp} is your Dabba Nation ${purpose} OTP`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #f0e6dd; border-radius: 14px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #FF6B00 0%, #E85D04 100%); padding: 24px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 26px;">Dabba Nation</h1>
              <p style="color: rgba(255,255,255,0.92); margin: 6px 0 0 0; font-size: 14px;">${purpose} Code</p>
            </div>
            <div style="background: #ffffff; padding: 30px; text-align: center;">
              <p style="color: #333333; font-size: 16px; margin: 0 0 16px 0;">Hello <strong>${user.name || 'User'}</strong>,</p>
              <p style="color: #555555; font-size: 14px; margin: 0 0 22px 0;">
                Use the 6-digit OTP below to complete your ${purpose.toLowerCase()}. This same code has also been sent to your registered mobile number.
              </p>
              <div style="background: #FFF5F0; border: 2px dashed #FF6B00; padding: 18px 24px; border-radius: 12px; display: inline-block; margin-bottom: 22px;">
                <span style="font-size: 32px; font-weight: 800; color: #FF6B00; letter-spacing: 6px;">${otp}</span>
              </div>
              <p style="color: #777777; font-size: 13px; margin: 0;">
                This OTP is valid for <strong>10 minutes</strong>. Please do not share this OTP with anyone.
              </p>
            </div>
          </div>
        `,
      }).catch((err) => {
        console.error('❌ [Email OTP Error]:', err.message);
      })
    : Promise.resolve();

  const smsPromise = user?.phone
    ? sendSmsOTP(user.phone, otp).catch((err) => {
        console.error('❌ [SMS OTP Error]:', err.message);
      })
    : Promise.resolve();

  await Promise.allSettled([emailPromise, smsPromise]);

  return {
    maskedEmail: maskEmail(user?.email),
    maskedPhone: maskPhone(user?.phone),
  };
}

module.exports = {
  normalizePhone,
  buildIdentifierQuery,
  maskEmail,
  maskPhone,
  sendSmsOTP,
  sendDualOTP,
};
