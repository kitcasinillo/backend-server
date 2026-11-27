/**
 * Red Flag Content Filter & Detection Engine
 * Detects attempts to share personal contact info or take transactions off-platform.
 */

const CATEGORY_LABELS = {
  off_platform_payment: 'Off-Platform Payment',
  phone: 'Phone Number',
  email: 'Email Address',
  url: 'External Link',
  social_handle: 'Social / Off-Platform Contact',
};

const WHITELISTED_DOMAINS = ['ultrahealers.com'];

const isWhitelistedHost = (value) => {
  const lower = String(value || '').toLowerCase();
  return WHITELISTED_DOMAINS.some(
    (domain) =>
      lower === domain ||
      lower.startsWith(`${domain}/`) ||
      lower.endsWith(`.${domain}`) ||
      lower.includes(`://${domain}`) ||
      lower.includes(`.${domain}/`) ||
      lower.endsWith(`@${domain}`)
  );
};

// Matches ISO dates (2026-11-26) or slash dates (11/26/2026) so they aren't misread as phone numbers
const DATE_LIKE_REGEX = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/;

const RULES = [
  {
    category: 'off_platform_payment',
    patterns: [
      // Global & regional P2P wallets, remittance services, and crypto
      /\b(?:venmo|zelle|cash\s*app|cashapp|paypal|pay\s*pal|apple\s*pay|google\s*pay|gpay|revolut|transferwise|remitly|xoom|worldremit|payoneer|skrill|neteller|airtm|western\s*union|moneygram|ria\s*money|monzo|starling\s*bank|chime\s*bank|interac|e-?transfer|sepa|bacs|chaps|faster\s*payments|bizum|twint|mb\s*way|swish|vipps|mobilepay|blik|sofort|giropay|satispay|payid|osko|bpay|paynow|paylah|duitnow|grabpay|touch\s*'?\s*n\s*go|paytm|phonepe|bhim|upi\s*(?:id|pay|transfer)?|imps|neft|rtgs|alipay|wechat\s*pay|paypay|kakaopay|gopay|promptpay|zalopay|gcash|paymaya|gotyme|instapay|pesonet|mercado\s*pago|nequi|daviplata|yape|spei|m-?pesa|flutterwave|paystack|stc\s*pay|binance\s*pay|coinbase|metamask|bitcoin|usdt|usdc|ethereum|crypto\s*(?:wallet|transfer|pay)?)\b/gi,
      // Contextual Wise / Pix / Maya (avoiding false positives on common English words)
      /\b(?:wise\s*(?:transfer|account|pay|app|link)|(?:via|through|on|using|by)\s+wise|pix\s*(?:key|transfer|pay)|(?:via|through|with|by)\s+pix|maya\s*(?:pay|account|number|wallet))\b/gi,
      // International banking identifiers & wire/transfer terms
      /\b(?:iban|swift\s*(?:code|bic)?|bic\s*code|routing\s*(?:number|#|no\.?)|aba\s*(?:number|routing)|sort\s*code|bsb\s*(?:code|number)?|ifsc\s*(?:code)?|transit\s*(?:number|code)|clabe|wire\s*transfer|bank\s*transfer|bank\s*deposit|direct\s*deposit|direct\s*transfer|ach\s*transfer|money\s*transfer|international\s*(?:wire|transfer|bank)|overseas\s*(?:transfer|bank|payment)|remittance|bank\s*account(?:\s*(?:number|#|no\.?|details|info))?|account\s*(?:number|#|no\.?)\s*[:#]?\s*\d{5,}|wallet\s+address)\b/gi,
      // Actual IBAN format (e.g., GB29 NWBK 6016 1331 9268 19 or DE89370400440532013000)
      /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){2,7}(?:[\s-]?[A-Z0-9]{1,4})?\b/g,
      // Major international / overseas bank names
      /\b(?:hsbc|barclays|lloyds\s*bank|natwest|santander|wells\s*fargo|bank\s*of\s*america|bofa|citibank|scotiabank|commbank|commonwealth\s*bank|westpac|deutsche\s*bank|bnp\s*paribas|maybank|icici\s*bank|hdfc\s*bank|unionbank|metrobank|landbank|bdo\s*unibank)\b/gi,
      // Shorter bank names requiring banking/payment context
      /\b(?:send|pay|transfer|deposit|wire|my|bank)\s+(?:to\s+)?(?:my\s+)?(?:chase|citi|td\s*bank|rbc|bmo|cibc|dbs|ocbc|uob|cimb|anz|nab|ing|bbva|icici|hdfc|sbi|bdo|bpi)\b/gi,
      // Off-platform circumvention phrases
      /\b(?:pay\s+(?:me\s+|us\s+)?(?:in\s+)?cash|pay\s+(?:me\s+|us\s+)?directly|pay\s+(?:me\s+|us\s+)?outside|send\s+(?:money|funds|payment)\s+(?:directly|to\s+my|via|through)|book\s+directly|transact\s+outside|avoid\s+(?:the\s+)?(?:platform\s+)?fees?|skip\s+(?:the\s+)?(?:platform\s+)?fees?|save\s+on\s+(?:the\s+)?fees?|off[- ]?platform|outside\s+(?:the\s+)?(?:app|platform|site|website))\b/gi,
    ],
  },
  {
    category: 'email',
    patterns: [
      /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
      /\b[a-z0-9._%+-]+\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\bat\b)\s*(?:gmail|yahoo|outlook|hotmail|icloud|protonmail|live|aol|[a-z0-9-]+)\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\bdot\b|\.)\s*(?:com|net|org|io|co|me|edu|gov)\b/gi,
    ],
  },
  {
    category: 'phone',
    patterns: [
      // Standard formatted phone numbers: +1 (555) 123-4567, (555) 123-4567, 555-123-4567, 555.123.4567
      /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{3}[\s.-])\d{3,4}[\s.-]\d{4}(?!\d)/g,
      // Contiguous 10-15 digit phone numbers (e.g., 5551234567 or +15551234567)
      /(?<!\d)\+?\d{10,15}(?!\d)/g,
      // Heavily spaced digits (7+ single digits separated by spaces/dashes/dots)
      /(?<!\d)(?:\d[\s._-]){6,14}\d(?!\d)/g,
      // Written-out number words (7+ consecutive number words)
      /\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s,-]+|$)){7,}/gi,
    ],
  },
  {
    category: 'url',
    patterns: [
      /\bhttps?:\/\/[^\s<>()]+/gi,
      /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>()]*)?/gi,
      /\b[a-z0-9-]+\.(?:com|net|org|io|co|me|app|site|link|ee|ly|calendly\.com)(?:\/[^\s<>()]*)?/gi,
    ],
  },
  {
    category: 'social_handle',
    patterns: [
      /\b(?:whatsapp|whats\s*app|telegram|snapchat|instagram|facebook|messenger|wechat|viber|skype|discord)\b/gi,
      /\b(?:ig|fb|sc|wa|insta)\s*[:@]\s*[a-z0-9._-]{2,30}\b/gi,
      /\b(?:dm\s+me|hit\s+me\s+up\s+on|find\s+me\s+on|message\s+me\s+on)\b/gi,
      /(?<![a-z0-9._%+-])@[a-z0-9._]{3,30}\b/gi,
    ],
  },
];

const buildWarningMessage = (categories) => {
  if (!categories.length) return null;
  if (categories.includes('off_platform_payment')) {
    return 'For your safety and payment protection, please keep all bookings and payments on UltraHealers. Off-platform transactions are not covered by our refund or dispute policies.';
  }
  return 'For your safety and privacy, please keep communication on UltraHealers. Sharing personal contact info or external links may be flagged for review.';
};

/**
 * Analyze a chat message for red-flag patterns.
 * @param {string} rawText
 * @returns {{
 *   flagged: boolean,
 *   severity: 'low' | 'medium' | 'high' | null,
 *   categories: string[],
 *   matches: Array<{ category: string, label: string, match: string }>,
 *   warningMessage: string | null
 * }}
 */
function detectRedFlags(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return {
      flagged: false,
      severity: null,
      categories: [],
      matches: [],
      warningMessage: null,
    };
  }

  const text = rawText.trim();
  const seen = new Set();
  const matches = [];
  const categorySet = new Set();

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const matchedText = String(m[0] || '').trim();
        if (!matchedText) continue;

        // Skip whitelisted UltraHealers URLs / emails
        if ((rule.category === 'url' || rule.category === 'email') && isWhitelistedHost(matchedText)) {
          continue;
        }

        // Skip date-like strings misread as phones
        if (rule.category === 'phone' && DATE_LIKE_REGEX.test(matchedText)) {
          continue;
        }

        // Avoid double-counting an email domain as a bare URL
        if (rule.category === 'url') {
          const charBefore = m.index > 0 ? text[m.index - 1] : '';
          if (charBefore === '@') continue;
        }

        const dedupeKey = `${rule.category}:${matchedText.toLowerCase()}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          categorySet.add(rule.category);
          matches.push({
            category: rule.category,
            label: CATEGORY_LABELS[rule.category] || rule.category,
            match: matchedText,
          });
        }
      }
    }
  }

  const categories = Array.from(categorySet);
  if (categories.length === 0) {
    return {
      flagged: false,
      severity: null,
      categories: [],
      matches: [],
      warningMessage: null,
    };
  }

  let severity = 'low';
  if (categories.includes('off_platform_payment') || categories.length >= 2) {
    severity = 'high';
  } else if (categories.some((c) => ['phone', 'email', 'url'].includes(c))) {
    severity = 'medium';
  }

  return {
    flagged: true,
    severity,
    categories,
    matches,
    warningMessage: buildWarningMessage(categories),
  };
}

module.exports = {
  detectRedFlags,
  CATEGORY_LABELS,
};
