# UltraHealers - Backend Server

The API server for the UltraHealers platform.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

## 📁 Project Structure

```
├── config/           # Configuration files
│   ├── database.js   # Database configuration
│   ├── email.js      # Email configuration
│   └── stripe.js     # Stripe configuration
├── controllers/      # Route controllers
├── middleware/       # Express middleware
├── models/          # Data models
├── routes/          # API routes
├── utils/           # Utility functions
├── server.js        # Main server file
└── Dockerfile       # Docker configuration
```

## 🔧 Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=5001

# Firebase Admin (Backend)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com

# Stripe (Backend)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# CORS Configuration
CORS_ORIGIN=http://localhost:5173,http://localhost:5174

# Session Configuration
SESSION_SECRET=your-super-secret-session-key
JWT_SECRET=your-jwt-secret-key
```

## 🚀 Deployment

### Koyeb Deployment

1. Connect your repository to Koyeb
2. Set the environment variables in Koyeb dashboard
3. Configure build and run commands:
   - **Build Command**: `npm install`
   - **Run Command**: `npm start`
   - **Port**: `5001`

### Docker Deployment

```bash
# Build Docker image
docker build -t ultrahealers-backend .

# Run container
docker run -p 5001:5001 --env-file .env ultrahealers-backend
```

## 🛠️ Development

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Firebase Firestore
- **Authentication**: Firebase Admin SDK
- **Payments**: Stripe
- **Email**: Nodemailer
- **Scheduling**: Node-cron

## 📝 Scripts

- `npm run dev` - Start development server with nodemon
- `npm start` - Start production server
- `npm run build` - Build confirmation (no actual build needed)
- `npm run lint` - Lint confirmation

## 🔗 API Endpoints

- `GET /health` - Health check endpoint
- `POST /api/healers` - Healer management
- `POST /api/bookings` - Booking management
- `POST /api/payments` - Payment processing
- `POST /webhook/stripe` - Stripe webhook handler
