const nodemailer = require('nodemailer');

// Email transporter setup
let emailTransporter = null;

const initializeEmailTransporter = () => {
  const emailPass = process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS;
  if (!process.env.EMAIL_USER || !emailPass) {
    console.warn('Email configuration not found. Email functions will not work.');
    return null;
  }

  // Support custom transactional SMTP (Resend, SendGrid, Postmark, AWS SES, etc.)
  if (process.env.EMAIL_HOST) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true' || process.env.EMAIL_PORT === '465',
      auth: {
        user: process.env.EMAIL_USER,
        pass: emailPass
      }
    });
    console.log(`✅ Transactional SMTP transporter initialized (${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT || 587})`);
  } else {
    // Fallback to Gmail service
    emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: emailPass
      }
    });
    console.log('✅ Gmail SMTP transporter initialized successfully');
  }

  return emailTransporter;
};

const getEmailTransporter = () => emailTransporter;

module.exports = {
  initializeEmailTransporter,
  getEmailTransporter
};

