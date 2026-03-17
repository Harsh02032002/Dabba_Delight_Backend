import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER || "harshdeep20020203@gmail.com",
    pass: process.env.EMAIL_PASS || "uyhkigsleomrloei",
  },
});

export const sendEmail = async (to, subject, text, html) => {
  try {
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || "harshdeep20020203@gmail.com";
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
