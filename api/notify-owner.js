export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { ownerId, workerName, jobName, action, timestamp } = req.body
  if (!ownerId) return res.json({ success: false, error: 'Missing ownerId' })

  // Resolve the owner's email server-side. Workers can't read the owner's
  // profile under RLS, and this keeps the email out of the browser entirely.
  let ownerEmail
  try {
    const lookup = await fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/rest/v1/profiles` +
        `?id=eq.${encodeURIComponent(ownerId)}&select=email`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    )
    const rows = await lookup.json()
    ownerEmail = rows?.[0]?.email
  } catch (err) {
    console.error('Owner lookup failed:', err)
    return res.json({ success: false, error: 'Owner lookup failed' })
  }
  if (!ownerEmail) return res.json({ success: false, error: 'Owner email not found' })

  const time = new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true
  })

  const subject = action === 'in'
    ? `${workerName} clocked in — ${jobName}`
    : `${workerName} clocked out — ${jobName}`

  const body = action === 'in'
    ? `${workerName} clocked in on ${jobName} at ${time}.`
    : `${workerName} clocked out of ${jobName} at ${time}.`

  try {
    // Using Resend for email — add RESEND_API_KEY to Vercel env variables
    // Sign up free at resend.com — 3,000 emails/month free
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Run-Site <onboarding@resend.dev>',
        to: ownerEmail,
        subject,
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1C2B3A; margin-bottom: 8px;">RUN-SITE</h2>
            <div style="background: #f4f6f9; border-radius: 12px; padding: 20px; margin-top: 16px;">
              <p style="font-size: 18px; font-weight: 700; color: #1C2B3A; margin: 0 0 8px;">${body}</p>
              <p style="font-size: 14px; color: #888; margin: 0;">Logged automatically by Run-Site</p>
            </div>
          </div>
        `
      })
    })

    if (!response.ok) throw new Error('Email failed')
    res.json({ success: true })
  } catch (err) {
    console.error('Notify error:', err)
    // Don't fail the clock-in if email fails — just log it
    res.json({ success: false, error: err.message })
  }
}