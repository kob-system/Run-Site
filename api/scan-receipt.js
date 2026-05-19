export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { imageBase64, mediaType } = req.body

  try {
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
            { type: 'text', text: 'Look at this receipt. Extract: 1) store name, 2) total amount. Reply ONLY in this format: STORE: [name] AMOUNT: [number only, no $ sign]' }
          ]
        }]
      })
    })

    const data = await response.json()
    const text = data.content[0].text
    const storeMatch = text.match(/STORE:\s*(.+?)(?:\s+AMOUNT|$)/i)
    const amountMatch = text.match(/AMOUNT:\s*([\d.]+)/i)

    res.json({
      store: storeMatch ? storeMatch[1].trim() : '',
      amount: amountMatch ? amountMatch[1] : ''
    })
  } catch (err) {
    res.status(500).json({ error: 'Scan failed' })
  }
}