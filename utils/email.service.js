const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail(to, subject, html) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('Email env vars missing, skipping email send', {
      EMAIL_USER: process.env.EMAIL_USER,
      EMAIL_PASS_SET: !!process.env.EMAIL_PASS,
    });
    return;
  }
  console.log('Sending email to', to, 'subject:', subject, 'from', process.env.EMAIL_USER);
  await transporter.sendMail({
    from: `"Dabba Nation" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
  console.log('Email sent to', to);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateCode };

