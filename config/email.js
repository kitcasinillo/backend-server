const nodemailer = require('nodemailer');

// Email transporter setup
let emailTransporter = null;

const initializeEmailTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.warn('Email configuration not found. Email functions will not work.');
    return null;
  }

  emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  console.log('✅ Email transporter initialized successfully');
  return emailTransporter;
};

const getEmailTransporter = () => emailTransporter;

module.exports = {
  initializeEmailTransporter,
  getEmailTransporter
};
