#!/usr/bin/env node
// Lightweight CLI to send a test event to n8n via the secure dispatcher

const path = require('path');
const fs = require('fs');

// Ensure backend .env is loaded
try {
  const envPath = path.resolve(__dirname, '..', '.env');
  require('dotenv').config({ path: envPath });
  console.log('✅ .env loaded from', envPath);
} catch (e) {
  console.warn('⚠️ Could not load .env:', e.message);
}

const { sendEvent } = require('../utils/n8n');

function parseArgs(argv) {
  const args = { event: 'booking.created', payload: null, file: null };
  for (const a of argv) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, null];
    switch (k) {
      case '--event':
      case '-e':
        args.event = v || 'booking.created';
        break;
      case '--payload':
      case '-p':
        args.payload = v ? safeJson(v) : null;
        break;
      case '--file':
      case '-f':
        args.file = v || null;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        // ignore unknown flags to keep CLI simple
        break;
    }
  }
  return args;
}

function safeJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function samplePayload(event) {
  const ts = new Date().toISOString();
  if (event === 'account.signup') {
    return {
      userId: 'u_demo_001',
      name: 'Demo User',
      email: 'demo.user@example.com',
      role: 'seeker',
    };
  }
  if (event === 'session.reminder') {
    return {
      bookingId: 'booking_demo_001',
      seeker: { name: 'Seeker User', email: 'seeker@example.com' },
      healer: { name: 'Healer User', email: 'healer@example.com' },
      sessionDate: ts,
      timezone: 'America/New_York',
    };
  }
  if (event === 'booking.created') {
    return {
      id: 'booking_demo_001',
      status: 'confirmed',
      seeker: { name: 'Seeker User', email: 'seeker@example.com' },
      healer: { name: 'Healer User', email: 'healer@example.com' },
      price: { amount: 150, currency: 'USD' },
      session: { date: ts, timezone: 'America/New_York' },
      source: 'web',
    };
  }
  if (event === 'retreat.booking') {
    return {
      retreatId: 'retreat_demo_001',
      title: 'Demo Retreat',
      seeker: { name: 'Seeker User', email: 'seeker@example.com' },
      healer: { name: 'Healer User', email: 'healer@example.com' },
      location: 'Ubud, Bali, Indonesia',
      dates: { start: '2024-03-01', end: '2024-03-07' },
      price: { amount: 2500, currency: 'USD' },
    };
  }
  // Fallback minimal payload
  return { timestamp: ts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`\nUltraHealers n8n test CLI\n\nUsage:\n  npm run n8n:test -- --event=booking.created\n  npm run n8n:test -- --event=user.created --payload={"userId":"u_1","email":"x@y.com"}\n  npm run n8n:test -- --file=payload.json\n\nFlags:\n  --event, -e    Event name (default: booking.created)\n  --payload, -p  JSON string for payload (optional)\n  --file, -f     Path to JSON file for payload (optional)\n  --help, -h     Show help\n`);
    process.exit(0);
  }

  let payload = args.payload;
  if (!payload && args.file) {
    try {
      const content = fs.readFileSync(path.resolve(process.cwd(), args.file), 'utf8');
      payload = JSON.parse(content);
    } catch (e) {
      console.error('❌ Failed to read payload file:', e.message);
      process.exit(1);
    }
  }
  if (!payload) payload = samplePayload(args.event);

  console.log('➡️ Sending event:', args.event);
  console.log('📦 Payload:', JSON.stringify(payload));

  try {
    const result = await sendEvent(args.event, payload, { meta: { source: 'cli' } });
    if (result.sent) {
      console.log(`✅ Delivered: status=${result.status}`);
    } else {
      console.log(`⚠️ Not sent: reason=${result.reason}`);
    }
    if (result.response) {
      console.log('📝 Response:', result.response);
    }
    process.exit(result.sent ? 0 : 2);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();