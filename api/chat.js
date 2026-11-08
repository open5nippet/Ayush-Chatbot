// ============================================================
// /api/chat.js — Vercel Serverless Function (Node.js)
//
// What this file does:
//   1. Receives a POST from the browser with { sessionId, message }
//   2. Validates the input (empty check, length, format)
//   3. Applies a simple in-memory rate limit per IP
//   4. Forwards the request to the n8n webhook with an API-key header
//   5. Returns the reply to the browser, or a friendly error
//
// Environment variables you must set in Vercel (and .env locally):
//   N8N_WEBHOOK_URL   — the full URL of your n8n production webhook
//   N8N_SHARED_SECRET — the secret string set in n8n's webhook node
//
// NODE VERSION NOTE: This file uses native fetch, which is available
// in Node.js 18 and later. Node 18 reached End-of-Life in April 2025.
// In Vercel Project Settings → General → Node.js Version, choose a
// currently supported version (20.x or 22.x). Check the current list at:
// https://vercel.com/docs/functions/runtimes/node-js#node.js-version
// ============================================================

// ─────────────────────────────────────────────────────────────
// SECTION 1 — Rate Limiting (in-memory, per IP)
//
// NOTE FOR BEGINNERS: In-memory means this data is stored in
// the RAM of whichever server instance handles the request.
// Vercel serverless functions can run on many instances at once,
// so this rate limit is best-effort only — it won't be perfectly
// accurate under heavy traffic. It still stops casual abuse.
// For production-grade rate limiting, use Vercel's KV store or
// a service like Upstash Redis.
// ─────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS  = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX         = 10;         // max requests per IP per window
const ipRequests             = new Map();  // Map<ip, { count, resetAt }>

function checkRateLimit(ip) {
  const now  = Date.now();
  const entry = ipRequests.get(ip);

  if (!entry || now > entry.resetAt) {
    // First request from this IP in the current window
    ipRequests.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false };
  }

  entry.count += 1;
  return { allowed: true };
}

// Periodically clean up old entries so the Map doesn't grow forever.
// In a serverless environment, setInterval may not fire reliably —
// this is fine; cleanup will happen on each cold start.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequests.entries()) {
    if (now > entry.resetAt) ipRequests.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// ─────────────────────────────────────────────────────────────
// SECTION 2 — Input Validation Helpers
// ─────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH  = 500;
const MAX_SESSION_ID_LENGTH = 64;
// UUID v4 pattern — allows the standard hyphenated format
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBody(body) {
  if (typeof body.message !== 'string' || body.message.trim().length === 0) {
    return 'message must be a non-empty string.';
  }
  if (body.message.trim().length > MAX_MESSAGE_LENGTH) {
    return `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`;
  }
  if (typeof body.sessionId !== 'string') {
    return 'sessionId must be a string.';
  }
  if (body.sessionId.length > MAX_SESSION_ID_LENGTH) {
    return `sessionId must be ${MAX_SESSION_ID_LENGTH} characters or fewer.`;
  }
  if (!UUID_PATTERN.test(body.sessionId)) {
    return 'sessionId must be a valid UUID.';
  }
  return null; // null means no error
}

// ─────────────────────────────────────────────────────────────
// SECTION 3 — Response Helpers
// ─────────────────────────────────────────────────────────────

/**
 * json(res, status, body) — sends a JSON response with security headers.
 * We always set:
 *   Cache-Control: no-store — prevent caching of sensitive chat data
 *   Content-Type: application/json
 */
function json(res, status, body) {
  res.setHeader('Content-Type',  'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

// ─────────────────────────────────────────────────────────────
// SECTION 4 — Main Handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {

  // ── 4a. Method check ──────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, {
      error:   'method_not_allowed',
      message: 'Only POST requests are accepted.',
    });
  }

  // ── 4b. Rate limiting ─────────────────────────────────────
  // x-forwarded-for is set by Vercel's proxy and contains the
  // real client IP. We fall back to 'unknown' if it's missing.
  const rawIp = req.headers['x-forwarded-for'] || 'unknown';
  // x-forwarded-for can be a comma-separated list; take the first IP.
  const clientIp = rawIp.split(',')[0].trim();

  const rateResult = checkRateLimit(clientIp);
  if (!rateResult.allowed) {
    return json(res, 429, {
      error:   'rate_limit',
      message: 'You have sent too many messages. Please wait a minute and try again.',
    });
  }

  // ── 4c. Parse and validate request body ──────────────────
  const body = req.body; // Vercel parses JSON bodies automatically
  if (!body || typeof body !== 'object') {
    return json(res, 400, {
      error:   'bad_request',
      message: 'Request body must be valid JSON.',
    });
  }

  const validationError = validateBody(body);
  if (validationError) {
    return json(res, 400, {
      error:   'validation_error',
      message: validationError,
    });
  }

  // ── 4d. Read environment variables ───────────────────────
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  const sharedSecret = process.env.N8N_SHARED_SECRET;

  if (!webhookUrl || !sharedSecret) {
    // This is a server-configuration problem, not a user error.
    // We log it on the server but return a vague message to the client.
    console.error('[chat] Missing N8N_WEBHOOK_URL or N8N_SHARED_SECRET env var.');
    return json(res, 503, {
      error:   'offline',
      message: 'The assistant is not configured correctly. Please contact the site owner.',
    });
  }

  // ── 4e. Forward request to n8n ───────────────────────────
  // AbortController lets us cancel the fetch if it takes too long.
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 25_000); // 25 seconds

  let upstreamRes;
  try {
    upstreamRes = await fetch(webhookUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        // The shared secret is NEVER sent to the browser.
        // It only travels from this server function to n8n.
        'x-api-key': sharedSecret,
      },
      body: JSON.stringify({
        sessionId: body.sessionId,
        message:   body.message.trim(),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      // The 25-second timeout was hit
      return json(res, 504, {
        error:   'timeout',
        message: 'The assistant is taking too long to respond. Please try again in a moment.',
      });
    }

    // Network error (n8n unreachable, DNS failure, tunnel down, etc.)
    // We do NOT log err.message in case it contains the webhook URL.
    console.error('[chat] Network error reaching upstream.');
    return json(res, 502, {
      error:   'offline',
      message: 'The assistant appears to be offline. Please try again later.',
    });
  } finally {
    clearTimeout(timeoutId);
  }

  // ── 4f. Handle upstream error responses ──────────────────
  if (upstreamRes.status === 429) {
    // The AI provider is rate-limiting n8n
    return json(res, 429, {
      error:   'rate_limit',
      message: 'The AI model is receiving too many requests right now. Please wait a minute and try again.',
    });
  }

  if (upstreamRes.status >= 500) {
    // n8n or the AI model had an internal error
    console.error(`[chat] Upstream returned ${upstreamRes.status}.`);
    return json(res, 502, {
      error:   'offline',
      message: 'The assistant ran into a problem. Please try again in a moment.',
    });
  }

  if (!upstreamRes.ok) {
    // Any other non-2xx (4xx from n8n, e.g. misconfigured workflow)
    console.error(`[chat] Upstream returned unexpected status ${upstreamRes.status}.`);
    return json(res, 502, {
      error:   'offline',
      message: 'The assistant returned an unexpected response. Please try again.',
    });
  }

  // ── 4g. Parse upstream response ──────────────────────────
  let upstreamData;
  try {
    upstreamData = await upstreamRes.json();
  } catch {
    console.error('[chat] Could not parse upstream JSON response.');
    return json(res, 502, {
      error:   'offline',
      message: 'The assistant returned an unreadable response. Please try again.',
    });
  }

  // Validate that n8n gave us the expected shape: { reply: "..." }
  if (typeof upstreamData.reply !== 'string') {
    console.error('[chat] Upstream response missing "reply" field.');
    return json(res, 502, {
      error:   'offline',
      message: 'The assistant returned an unexpected format. Please try again.',
    });
  }

  // ── 4h. Return the reply to the browser ──────────────────
  return json(res, 200, {
    reply: upstreamData.reply,
  });
}
