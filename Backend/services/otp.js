/**
 * Modular Enterprise OTP Verification Service
 * Supports:
 * 1. Dev Mode (Default: logs OTP to terminal + Master OTP 123456 for instant testing)
 * 2. Fast2SMS (India Quick OTP API - Free signup credits, no DLT needed for test)
 * 3. 2Factor.in (India Transactional/OTP Gateway)
 * 4. Twilio SMS (Global Gateway)
 */

const https = require('https');
const http = require('http');

const otpStore = new Map(); // phone -> { otp, expiresAt, attempts }

const OTP_MODE = process.env.OTP_MODE || 'dev';
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Helper to make HTTP/HTTPS GET/POST requests without external dependencies
 */
function makeHttpRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      ...options
    };

    const req = client.request(parsedUrl, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', err => reject(err));
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

/**
 * Send real SMS via Fast2SMS (India)
 */
async function sendViaFast2SMS(cleanPhone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return null;

  try {
    const postData = JSON.stringify({
      route: 'otp',
      variables_values: otp,
      numbers: cleanPhone
    });

    const res = await makeHttpRequest('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, postData);

    if (res.status === 200 && res.data && res.data.return === true) {
      console.log(`✅ [SMS GATEWAY: Fast2SMS] OTP sent successfully to +91 ${cleanPhone}`);
      return { success: true, provider: 'Fast2SMS' };
    } else {
      console.error(`⚠️ [SMS GATEWAY: Fast2SMS Error]`, res.data);
      return { success: false, error: res.data?.message || 'Fast2SMS delivery failed' };
    }
  } catch (err) {
    console.error(`❌ [Fast2SMS Exception]`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send real SMS via 2Factor (India)
 */
async function sendVia2Factor(cleanPhone, otp) {
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://2factor.in/API/V1/${apiKey}/SMS/${cleanPhone}/${otp}/AUTHSMS`;
    const res = await makeHttpRequest(url, { method: 'GET' });

    if (res.status === 200 && res.data && res.data.Status === 'Success') {
      console.log(`✅ [SMS GATEWAY: 2Factor] OTP sent to +91 ${cleanPhone}`);
      return { success: true, provider: '2Factor' };
    } else {
      console.error(`⚠️ [SMS GATEWAY: 2Factor Error]`, res.data);
      return { success: false, error: res.data?.Details || '2Factor delivery failed' };
    }
  } catch (err) {
    console.error(`❌ [2Factor Exception]`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send real SMS via Twilio
 */
async function sendViaTwilio(cleanPhone, otp) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) return null;

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const postData = new URLSearchParams({
      To: `+91${cleanPhone}`,
      From: from,
      Body: `Your Rudraksha Packers & Movers verification code is: ${otp}. Valid for 5 minutes.`
    }).toString();

    const res = await makeHttpRequest(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, postData);

    if (res.status === 200 || res.status === 201) {
      console.log(`✅ [SMS GATEWAY: Twilio] OTP sent to +91 ${cleanPhone}`);
      return { success: true, provider: 'Twilio' };
    } else {
      console.error(`⚠️ [SMS GATEWAY: Twilio Error]`, res.data);
      return { success: false, error: res.data?.message || 'Twilio delivery failed' };
    }
  } catch (err) {
    console.error(`❌ [Twilio Exception]`, err.message);
    return { success: false, error: err.message };
  }
}

async function sendOTP(phone) {
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    return { success: false, error: 'Invalid phone number. Please enter 10 digits.' };
  }

  const otp = generateOTP();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;

  otpStore.set(cleanPhone, {
    otp,
    expiresAt,
    attempts: 0
  });

  console.log(`\n========================================`);
  console.log(`📱 [OTP SERVICE] Generated for +91 ${cleanPhone}`);
  console.log(`🔑 Verification Code: ${otp} (Valid for 5 mins)`);
  if (OTP_MODE === 'dev') {
    console.log(`💡 Dev Mode Active: You can also use '123456' to verify immediately`);
  }
  console.log(`========================================\n`);

  let smsSent = false;
  let smsProviderName = null;

  // Attempt real SMS if API keys are configured in .env
  if (process.env.FAST2SMS_API_KEY) {
    const result = await sendViaFast2SMS(cleanPhone, otp);
    if (result && result.success) {
      smsSent = true;
      smsProviderName = result.provider;
    }
  } else if (process.env.TWO_FACTOR_API_KEY) {
    const result = await sendVia2Factor(cleanPhone, otp);
    if (result && result.success) {
      smsSent = true;
      smsProviderName = result.provider;
    }
  } else if (process.env.TWILIO_ACCOUNT_SID) {
    const result = await sendViaTwilio(cleanPhone, otp);
    if (result && result.success) {
      smsSent = true;
      smsProviderName = result.provider;
    }
  }

  return {
    success: true,
    message: smsSent 
      ? `OTP successfully sent to +91 ${cleanPhone} via SMS.` 
      : (OTP_MODE === 'dev' 
          ? `[Dev Mode] OTP: ${otp} (Or enter 123456)` 
          : 'OTP generated. Please check console or SMS gateway.'),
    devOtp: OTP_MODE === 'dev' ? otp : undefined,
    smsDelivered: smsSent,
    smsProvider: smsProviderName,
    expiresInSeconds: 300
  };
}

function verifyOTP(phone, userOtp) {
  const cleanPhone = String(phone).replace(/\D/g, '');
  const enteredOtp = String(userOtp).trim();

  // Allow 123456 in dev mode
  if (OTP_MODE === 'dev' && process.env.NODE_ENV !== 'production' && enteredOtp === '123456') {
    otpStore.delete(cleanPhone);
    return { success: true, message: 'OTP verified successfully (Master Dev Code).' };
  }

  const record = otpStore.get(cleanPhone);
  if (!record) {
    return { success: false, error: 'No active OTP requested for this number or OTP has expired.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(cleanPhone);
    return { success: false, error: 'OTP has expired. Please request a new code.' };
  }

  if (record.attempts >= 5) {
    otpStore.delete(cleanPhone);
    return { success: false, error: 'Too many incorrect attempts. Please request a new OTP.' };
  }

  if (record.otp !== enteredOtp) {
    record.attempts += 1;
    return { success: false, error: 'Invalid OTP entered. Please check and try again.' };
  }

  // Success
  otpStore.delete(cleanPhone);
  return { success: true, message: 'OTP verified successfully.' };
}

module.exports = {
  sendOTP,
  verifyOTP
};
