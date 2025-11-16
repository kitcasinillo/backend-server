const crypto = require('crypto');

// Simple in-memory store. For production, prefer Redis or a DB.
const tokens = new Map();

function createToken(uid, ttlMs = 60_000) {
  const code = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + ttlMs;
  tokens.set(code, { uid, expiresAt });
  return code;
}

function consumeToken(code) {
  const entry = tokens.get(code);
  if (!entry) return null;
  tokens.delete(code);
  if (Date.now() > entry.expiresAt) return null;
  return entry.uid;
}

// Background cleanup
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of tokens.entries()) {
    if (entry.expiresAt < now) tokens.delete(code);
  }
}, 60_000);

module.exports = { createToken, consumeToken };