'use strict';
// J&A Scan-Out: server-only bridge Vercel -> Apps Script -> private Google Sheet.
// No Supabase, POS, or inventory mutation occurs here.
const { createHash, timingSafeEqual } = require('node:crypto');
const WAYBILL_RE = /^[A-Z0-9-]{8,45}$/;

function constantTimeMatch(input, expected) {
  const a = createHash('sha256').update(String(input)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function safeText(value, max = 60) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'error', message: 'Method not allowed.' });
  }
  const pin = process.env.SCAN_OPERATOR_PASSWORD;
  const bridgeSecret = process.env.SHEETS_BRIDGE_SECRET;
  const url = process.env.GOOGLE_SHEETS_WEB_APP_URL;
  if (!pin || pin.length < 12 || !bridgeSecret || bridgeSecret.length < 24 ||
      !url || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
    return res.status(503).json({ status: 'error', message: 'Scanner is not configured. Contact the admin.' });
  }
  const supplied = req.headers['x-scan-password'];
  if (typeof supplied !== 'string' || !constantTimeMatch(supplied, pin)) {
    return res.status(401).json({ status: 'error', message: 'Incorrect scanner access password.' });
  }
  let input = req.body;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch (_) { input = null; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ status: 'error', message: 'Invalid request.' });
  }
  const waybill = safeText(input.waybill, 80).toUpperCase().replace(/\s+/g, '');
  if (!WAYBILL_RE.test(waybill)) {
    return res.status(400).json({ status: 'invalid', message: 'Invalid waybill format. Check the scan and retry.' });
  }
  const operator = safeText(input.operator, 60);
  const shop = 'JA Enterprises'; // No stock owner ambiguity on emergency scanner.
  const courier = waybill.startsWith('SPEPH') ? 'SPX' : waybill.startsWith('JT') ? 'J&T' : '';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: bridgeSecret, waybill, operator, shop, courier }),
      redirect: 'follow',
      signal: AbortSignal.timeout(18000),
    });
    // Google ContentService usually sends a 302 to script.googleusercontent.com.
    // Do not report saved until its JSON acknowledgment is parsed.
    if (!response.ok) throw new Error('Apps Script upstream HTTP ' + response.status);
    const result = await response.json();
    if (!result || !['saved', 'duplicate', 'invalid', 'error'].includes(result.status)) {
      throw new Error('Unexpected Apps Script response');
    }
    if (result.status === 'saved') {
      return res.status(200).json({ status: 'saved', waybill,
        timestampPH: safeText(result.timestampPH || '', 30),
        message: 'SAVED - SCAN OUT' });
    }
    if (result.status === 'duplicate') {
      return res.status(200).json({ status: 'duplicate', waybill,
        message: 'DUPLICATE - NOT SAVED AGAIN' });
    }
    if (result.status === 'invalid') {
      return res.status(400).json({ status: 'invalid', waybill,
        message: 'Invalid waybill format.' });
    }
    return res.status(503).json({ status: 'error', waybill,
      message: 'Could not confirm save. Check SCAN LOG before retrying.' });
  } catch (err) {
    // Never echo raw Google, spreadsheet IDs, upstream URLs, or secrets to clients.
    console.error('Scan-Out bridge unavailable:', err && err.message);
    return res.status(502).json({ status: 'error', waybill,
      message: 'Save not confirmed. Check the Google Sheet before retrying.' });
  }
};
