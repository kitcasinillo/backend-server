const crypto = require('crypto');

// Secure n8n dispatcher with HMAC, anti‑replay metadata, and retries
const getConfig = () => ({
  enabled: process.env.N8N_ENABLED === 'true' || !!(process.env.N8N_WEBHOOK_URL || process.env.N8N_API_BASE_URL),
  webhookUrl: process.env.N8N_WEBHOOK_URL,
  baseUrl: process.env.N8N_API_BASE_URL,
  apiKey: process.env.N8N_API_KEY,
  environment: process.env.NODE_ENV || 'development',
});

const resolveUrl = (event) => {
  const { webhookUrl, baseUrl } = getConfig();
  if (webhookUrl && webhookUrl.length > 0) return webhookUrl;
  if (!baseUrl || baseUrl.length === 0) return null;
  const trimmed = baseUrl.replace(/\/$/, '');
  // Default convention: single endpoint per event under /webhook/:event
  return `${trimmed}/webhook/${encodeURIComponent(event)}`;
};

const hmacSignature = (secret, timestamp, nonce, bodyString) => {
  const input = `${timestamp}.${nonce}.${bodyString}`;
  return crypto.createHmac('sha256', String(secret)).update(input).digest('hex');
};

const buildHeaders = (bodyString, idempotencyKey) => {
  const { apiKey } = getConfig();
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey || '',
    'X-N8N-Timestamp': ts,
    'X-N8N-Nonce': nonce,
    'X-Idempotency-Key': idempotencyKey || crypto.randomUUID(),
  };
  if (apiKey) headers['X-N8N-Signature'] = hmacSignature(apiKey, ts, nonce, bodyString);
  return headers;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(url, headers, bodyString, { retries = 3, backoffMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: bodyString });
      const text = await res.text();
      if (res.ok) return { ok: true, status: res.status, body: text };
      // Retry on 429/5xx
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastError = new Error(`n8n responded ${res.status}: ${text}`);
        if (attempt < retries) await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, status: res.status, body: text };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(backoffMs * Math.pow(2, attempt));
    }
  }
  throw lastError || new Error('Unknown error posting to n8n');
}

function buildEnvelope(event, payload, meta = {}) {
  const cfg = getConfig();
  const nowIso = new Date().toISOString();
  const envelope = {
    event,
    payload,
    meta: {
      source: meta.source || 'backend',
      environment: cfg.environment,
      timestamp: nowIso,
      ...meta,
    },
  };
  return envelope;
}

async function sendEvent(event, payload = {}, options = {}) {
  const cfg = getConfig();
  if (!cfg.enabled) {
    console.log('ℹ️ n8n not configured. Event will be skipped:', event);
    return { sent: false, reason: 'disabled' };
  }
  const url = resolveUrl(event);
  if (!url) {
    console.warn('⚠️ n8n URL not set. Skipping event:', event);
    return { sent: false, reason: 'no_url' };
  }

  // If a single webhookUrl is configured, send flat JSON body with eventType and payload fields
  let body;
  const useFlatBody = !!cfg.webhookUrl;
  if (useFlatBody) {
    body = { eventType: event, ...(payload || {}) };
  } else {
    body = buildEnvelope(event, payload, options.meta);
  }
  const bodyString = JSON.stringify(body);
  const idempotencyKey = options.idempotencyKey ||
    payload.id || payload.bookingId || payload.paymentIntentId || `${event}-${Date.now()}`;
  const headers = buildHeaders(bodyString, idempotencyKey);

  const result = await postWithRetry(url, headers, bodyString, options.retry || {});
  return { sent: result.ok, status: result.status, response: result.body };
}

async function ping() {
  return sendEvent('system.ping', { message: 'hello from backend' });
}

module.exports = {
  sendEvent,
  ping,
};