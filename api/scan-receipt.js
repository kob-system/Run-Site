// Receipt OCR via the Claude API. Requires an authenticated Supabase user so
// this paid endpoint can't be hit anonymously to burn the API budget.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Anthropic can return transient 429 (rate limit), 529 (overloaded), or 5xx.
// Retry those with exponential backoff; 4xx (auth/validation) fail fast.
const isRetryableStatus = (s) => s === 429 || s === 529 || (s >= 500 && s < 600);

async function withRetry(fn) {
  const backoffs = [400, 900, 2000];
  let lastErr;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < backoffs.length && e && isRetryableStatus(e.status)) {
        console.error('scan-receipt: retrying Anthropic call', e.status, 'attempt', attempt + 1);
        await sleep(backoffs[attempt]);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function getUserId(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
    })
    if (!r.ok) return null
    const u = await r.json()
    return u && u.id ? u.id : null
  } catch { return null }
}

// Per-user rate limit via the rate_limit_hit() Postgres function (no extra infra).
// Returns true if the call is allowed. FAILS CLOSED on this PAID endpoint: if the
// rate check can't positively confirm the call is under the cap (limiter missing,
// RPC error, or network failure), we block it (429) rather than risk an unbounded
// Anthropic bill. A transient hiccup costs a user a retry; failing open could cost
// real money on a runaway loop.
async function allowedRate(uid, bucket, max, windowSecs) {
  if (!SUPABASE_URL || !SERVICE_KEY) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: uid, p_bucket: bucket, p_max: max, p_window_secs: windowSecs })
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch { return false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.ANTHROPIC_KEY) {
    console.error('scan-receipt: ANTHROPIC_KEY is not set')
    return res.status(500).json({ error: 'Server misconfigured' })
  }

  const uid = await getUserId(req)
  if (!uid) return res.status(401).json({ error: 'Unauthorized' })

  // Cap paid OCR calls at 40/hour per user — generous for real receipt scanning,
  // a hard stop on a runaway loop draining the Anthropic budget.
  if (!(await allowedRate(uid, 'scan-receipt', 40, 3600))) {
    return res.status(429).json({ error: 'Too many scans right now. Please wait a bit and try again.' })
  }

  const { imageBase64, mediaType } = req.body || {}
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'Missing image' })
  }
  if (imageBase64.length > 7_000_000) {
    return res.status(413).json({ error: 'Image too large. Please use a smaller photo.' })
  }
  if (!ALLOWED_MEDIA.includes(mediaType)) {
    return res.status(415).json({ error: 'Unsupported image type' })
  }

  try {
    let data;
    try {
      data = await withRetry(async () => {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
                { type: 'text', text: 'Look at this receipt. Extract: 1) store name, 2) total amount, 3) date, 4) sales tax. Reply ONLY in this format: STORE: [name] AMOUNT: [number only, no $ sign] DATE: [YYYY-MM-DD, or NONE if not shown] TAX: [number only, no $ sign, or NONE if not shown]' }
              ]
            }]
          })
        });
        const body = await response.json();
        if (!response.ok) {
          console.error('scan-receipt: Anthropic error', response.status, body && body.error);
          const e = new Error('anthropic');
          e.status = response.status;
          throw e;
        }
        return body;
      });
    } catch (e) {
      if (e && e.message === 'anthropic') {
        return res.status(502).json({ error: 'Scan service unavailable' });
      }
      throw e;
    }

    const text = data && data.content && data.content[0] && data.content[0].text
    if (!text) return res.json({ store: '', amount: '', date: null, tax: null })

    const storeMatch = text.match(/STORE:\s*(.+?)(?:\s+AMOUNT|$)/i)
    const amountMatch = text.match(/AMOUNT:\s*([\d.]+)/i)
    const dateMatch = text.match(/DATE:\s*(.+?)(?:\s+TAX|$)/i)
    const taxMatch = text.match(/TAX:\s*([\d.]+)/i)
    const dateVal = dateMatch ? dateMatch[1].trim() : ''
    res.json({
      store: storeMatch ? storeMatch[1].trim() : '',
      amount: amountMatch ? amountMatch[1] : '',
      date: dateVal && !/^none$/i.test(dateVal) ? dateVal : null,
      tax: taxMatch ? taxMatch[1] : null
    })
  } catch (err) {
    console.error('scan-receipt failed:', err)
    res.status(500).json({ error: 'Scan failed' })
  }
}
