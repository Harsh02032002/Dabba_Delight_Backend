const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

async function sendEmail(toOrObj, subjectArg, htmlArg) {
  const to = typeof toOrObj === 'object' && toOrObj !== null ? toOrObj.to : toOrObj;
  const subject = typeof toOrObj === 'object' && toOrObj !== null ? toOrObj.subject : subjectArg;
  const html = typeof toOrObj === 'object' && toOrObj !== null ? toOrObj.html : htmlArg;

  if (!to) return;

  const mailer = getTransporter();
  if (!mailer) {
    console.warn('Email env vars missing, skipping email send', {
      EMAIL_USER: process.env.EMAIL_USER,
      EMAIL_PASS_SET: !!process.env.EMAIL_PASS,
    });
    return;
  }
  console.log('📧 Sending email to:', to, '| Subject:', subject);
  await mailer.sendMail({
    from: `"Dabba Nation" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
  console.log('✅ Email sent to:', to);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = { sendEmail, generateCode };

