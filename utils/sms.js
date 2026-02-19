import Twilio from "twilio";

let client = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = Twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
}

export const sendSMS = async (to, body) => {
  try {
    if (!client) {
      console.warn("Twilio client not configured. Skipping SMS.");
      return null;
    }
    const msg = await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    return msg;
  } catch (err) {
    console.error("sendSMS error:", err);
    throw err;
  }
};

export default sendSMS;
