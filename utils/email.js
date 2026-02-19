import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendEmail = async (to, subject, text, html) => {
  try {
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: text || html,
      html: html || undefined,
    });
    return info;
  } catch (err) {
    console.error("sendEmail error:", err);
    throw err;
  }
};

export default sendEmail;
