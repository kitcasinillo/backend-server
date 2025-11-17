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
# Choose ONE of the following methods:
# 1) Escaped-newline PEM in env (works in most dashboards)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n
# 2) Base64-encoded private key (reliable in cloud envs)
# FIREBASE_PRIVATE_KEY_BASE64=ewo... (base64 of full JSON key contents)

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
   - Recommended env setup for Firebase Admin:
     - Use `FIREBASE_PRIVATE_KEY_BASE64` or ensure `FIREBASE_PRIVATE_KEY` uses `\n` for newlines without quotes.

### Default Routes
- `GET /` returns a simple JSON status (200) to avoid noisy 404s in platform probes.
- `GET /favicon.ico` returns 204.

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
- `npm run n8n:test` - Send a test event to n8n via secure dispatcher
- `npm run n8n:ping` - Send a ping event to n8n

## 🔧 n8n Test CLI

Use the bundled CLI to validate your n8n webhook:

```bash
# Ping the workflow
npm run n8n:ping

# Send a specific event (defaults to booking.created)
npm run n8n:test -- --event=booking.created

# Provide a custom payload via JSON string
npm run n8n:test -- --event=user.created --payload={"userId":"u_1","email":"x@y.com"}

# Or load payload from a file
npm run n8n:test -- --event=retreat.created --file=payload.json
```

The CLI uses `backend-server/utils/n8n.js` which adds HMAC signature (`X-N8N-Signature`), `X-API-Key`, anti‑replay headers, and retries.

## 🔗 API Endpoints

- `GET /health` - Health check endpoint
- `POST /api/healers` - Healer management
- `POST /api/bookings` - Booking management
- `POST /api/payments` - Payment processing
- `POST /webhook/stripe` - Stripe webhook handler
