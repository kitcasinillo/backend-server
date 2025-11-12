const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();
console.log('✅ Environment variables loaded');

// Import configurations
const { initializeFirebase } = require('./config/database');
const { initializeStripe } = require('./config/stripe');
const { initializeEmailTransporter } = require('./config/email');

// Import routes
const paymentRoutes = require('./routes/paymentRoutes');
const healerRoutes = require('./routes/healerRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

// Import commission config for logging
const COMMISSION_CONFIG = require('./config/commission');

// Import notification scheduler
const { initializeScheduler } = require('./controllers/notificationController');

// Import settings controller
const { initializeSettings } = require('./controllers/settingsController');

const app = express();
const PORT = process.env.PORT || 5001;

// Initialize services
initializeFirebase();
initializeStripe();
initializeEmailTransporter();

// Initialize settings (create defaults if not exist)
initializeSettings().catch(err => console.error('Failed to initialize settings:', err));

// Initialize notification scheduler
initializeScheduler();

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()) || [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5178',
  'http://localhost:3000'
];

// Helper: detect localhost origins (allow across environments for local dev)
const isLocalhostOrigin = (o) => {
  return typeof o === 'string' && (
    o.startsWith('http://localhost:') ||
    o.startsWith('http://127.0.0.1:') ||
    o.startsWith('https://localhost:') ||
    o.startsWith('https://127.0.0.1:')
  );
};

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Always allow localhost origins for local development (even if NODE_ENV=production)
    if (isLocalhostOrigin(origin)) {
      callback(null, true);
      return;
    }

    // In production, check against allowed origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// API Routes
app.use('/api', paymentRoutes);
app.use('/api/healer', healerRoutes);
app.use('/api', webhookRoutes);
app.use('/api', bookingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Route not found' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Ultra Healers Server (MVC + Commission Model + Notifications) running on port ${PORT}`);
  console.log(`📧 Email service: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured'}`);
  console.log(`💳 Stripe service: ${process.env.STRIPE_SECRET_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
  console.log(`💰 Commission Model: ${COMMISSION_CONFIG.HEALER_COMMISSION_PERCENT}% Healer + ${COMMISSION_CONFIG.SEEKER_FEE_PERCENT}% Seeker`);
  console.log(`⏰ Notification Service: Active (runs every 6 hours)`);
  
  // Additional configuration info
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('\n⚠️  STRIPE CONFIGURATION ISSUES:');
    console.log('   • STRIPE_SECRET_KEY is missing from .env file');
    console.log('   • Get your Stripe secret key from: https://dashboard.stripe.com/apikeys');
    console.log('   • Add it to your .env file: STRIPE_SECRET_KEY=sk_test_your_actual_key');
  } else if (process.env.STRIPE_SECRET_KEY === 'sk_test_your_stripe_secret_key_here') {
    console.log('\n⚠️  STRIPE CONFIGURATION ISSUES:');
    console.log('   • STRIPE_SECRET_KEY is still using placeholder value');
    console.log('   • Replace with your actual Stripe secret key');
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.log('\n⚠️  EMAIL CONFIGURATION ISSUES:');
    console.log('   • EMAIL_USER or EMAIL_PASSWORD is missing from .env file');
    console.log('   • Notification emails will not be sent without email configuration');
    console.log('   • Add to your .env file: EMAIL_USER=your_email@gmail.com, EMAIL_PASSWORD=your_app_password');
  }
});

module.exports = app;