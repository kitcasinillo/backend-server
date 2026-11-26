const assert = require('assert');
const { detectRedFlags } = require('../utils/redFlagDetector');

const cases = [
  {
    name: 'Standard US phone number',
    text: 'Hey call me at (555) 234-5678 before the session',
    expectFlagged: true,
    expectCategories: ['phone'],
    expectSeverity: 'medium',
  },
  {
    name: 'Spaced obfuscated phone number',
    text: 'My number is 5 5 5 2 3 4 5 6 7 8',
    expectFlagged: true,
    expectCategories: ['phone'],
    expectSeverity: 'medium',
  },
  {
    name: 'Written-out phone number',
    text: 'Reach me at five five five one two three four five six seven',
    expectFlagged: true,
    expectCategories: ['phone'],
    expectSeverity: 'medium',
  },
  {
    name: 'Standard email address',
    text: 'Send details to healer.jane@gmail.com please',
    expectFlagged: true,
    expectCategories: ['email'],
    expectSeverity: 'medium',
  },
  {
    name: 'Obfuscated email address',
    text: 'Email me at jane at gmail dot com',
    expectFlagged: true,
    expectCategories: ['email'],
    expectSeverity: 'medium',
  },
  {
    name: 'External payment app (Venmo)',
    text: 'You can just pay me on Venmo to save on fees',
    expectFlagged: true,
    expectCategories: ['off_platform_payment'],
    expectSeverity: 'high',
  },
  {
    name: 'Combined phone + off-platform payment -> high severity',
    text: 'Text me at 555-888-9999 and pay directly via Zelle',
    expectFlagged: true,
    expectCategories: ['phone', 'off_platform_payment'],
    expectSeverity: 'high',
  },
  {
    name: 'Social handle / WhatsApp',
    text: 'Let us chat on WhatsApp instead',
    expectFlagged: true,
    expectCategories: ['social_handle'],
    expectSeverity: 'low',
  },
  {
    name: 'External URL',
    text: 'Book through my site https://myhealingpractice.com/book',
    expectFlagged: true,
    expectCategories: ['url'],
    expectSeverity: 'medium',
  },
  {
    name: 'Whitelisted UltraHealers URL is NOT flagged',
    text: 'Here is my listing https://ultrahealers.com/healers/123',
    expectFlagged: false,
    expectCategories: [],
    expectSeverity: null,
  },
  {
    name: 'Normal booking conversation with date and price is NOT flagged',
    text: 'Looking forward to our 3pm session on 2026-11-26! The $120 package sounds great.',
    expectFlagged: false,
    expectCategories: [],
    expectSeverity: null,
  },
  {
    name: 'Normal meeting sentence with "at" is NOT flagged',
    text: 'Let us meet at the studio entrance at 10am.',
    expectFlagged: false,
    expectCategories: [],
    expectSeverity: null,
  },
  {
    name: 'Overseas IBAN + SEPA transfer',
    text: 'Please send via SEPA to DE89370400440532013000',
    expectFlagged: true,
    expectCategories: ['off_platform_payment'],
    expectSeverity: 'high',
  },
  {
    name: 'Overseas Wise / Remitly transfer',
    text: 'You can pay me via Wise or Remitly instead',
    expectFlagged: true,
    expectCategories: ['off_platform_payment'],
    expectSeverity: 'high',
  },
  {
    name: 'Overseas bank + SWIFT / routing details',
    text: 'Wire it to my HSBC account, SWIFT code is HBUKGB4B',
    expectFlagged: true,
    expectCategories: ['off_platform_payment'],
    expectSeverity: 'high',
  },
  {
    name: 'UK / AU / SG / IN regional payment rails',
    text: 'Send through PayID or PayNow or UPI',
    expectFlagged: true,
    expectCategories: ['off_platform_payment'],
    expectSeverity: 'high',
  },
  {
    name: 'Overseas bank with context (Chase / DBS)',
    text: 'Just transfer to my Chase or my DBS account',
    expectFlagged: true,
    expectCategories: ['off_platform_payment'],
    expectSeverity: 'high',
  },
  {
    name: 'Common word "wise" in normal wellness chat is NOT flagged',
    text: 'That is a very wise reflection on your healing journey.',
    expectFlagged: false,
    expectCategories: [],
    expectSeverity: null,
  },
];

let passed = 0;
for (const tc of cases) {
  const res = detectRedFlags(tc.text);
  assert.strictEqual(res.flagged, tc.expectFlagged, `[${tc.name}] flagged mismatch: got ${res.flagged}`);
  assert.strictEqual(res.severity, tc.expectSeverity, `[${tc.name}] severity mismatch: got ${res.severity}`);
  for (const cat of tc.expectCategories) {
    assert.ok(
      res.categories.includes(cat),
      `[${tc.name}] expected category "${cat}" in [${res.categories.join(', ')}]`
    );
  }
  passed += 1;
  console.log(`✅ PASS: ${tc.name}`);
}

console.log(`\n🎉 All ${passed}/${cases.length} red-flag detector tests passed!`);
