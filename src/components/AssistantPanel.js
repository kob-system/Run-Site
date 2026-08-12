import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// In-app AI assistant. A floating ✨ button opens a bottom sheet.
// Type a question or an action; reads answer inline, writes show a confirm card
// before anything saves. Every executed action is audited (Activity tab).
// v0.5: role="worker" mounts the crew persona (clock in/out, hours, schedule,
// time off, AND logging a scanned receipt/expense — the API enforces the toolset
// server-side and books a crew expense to the boss's tenant, this only sets copy).
// Mic dictation (live interim text) where the browser supports SpeechRecognition,
// and receipt photo → /api/scan-receipt → normal add_expense confirm flow, now
// for owner and crew alike (date + tax read off the receipt flow into the ask).
// v0.6: talk-back — a spoken question gets a spoken answer (speechSynthesis), so
// a guy with gloves on and hands full never has to look at the screen. Typed
// turns stay silent on purpose; the header 🔊 kills it outright.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
const SS = typeof window !== 'undefined' ? window.speechSynthesis : null
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// Talk-back. The rule is deliberately narrow: it speaks ONLY when the turn it is
// answering came in through the mic. Talk to it and it talks back; type at it and
// it stays quiet. That keeps a guy with his hands full hands-free without making
// the app start shouting at anyone who taps a template on a quiet jobsite.
// 'auto' | 'off', remembered per device. The header 🔊 flips it.
const SPEAK_KEY = 'jt_assistant_speak'
const speakPref = () => {
  try { return localStorage.getItem(SPEAK_KEY) === 'off' ? 'off' : 'auto' } catch { return 'auto' }
}

// Strip what sounds wrong out loud: emoji, markdown bold, bullet glyphs, and the
// bracketed control lines we feed the model but never show. Long replies get cut
// at a sentence boundary — iOS Safari mangles very long utterances anyway, and a
// contractor wants the answer, not a paragraph read at him.
function speakable(text) {
  if (!text) return ''
  let t = String(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[*_`#>]/g, ' ')
    .replace(/[•–—]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > 320) {
    const cut = t.slice(0, 320)
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    t = stop > 120 ? cut.slice(0, stop + 1) : cut + '…'
  }
  return t
}

// Tap-a-template starters. A chip does nothing clever — it just sends a plain
// English opener, so the assistant runs its normal guided flow (GUIDED SETUPS
// in api/assistant.js: one short question per message) and the usual Confirm
// card is still the last thing before anything saves. Nobody has to know what
// to type; the app tells them what it can do.
const OWNER_TEMPLATES = [
  { icon: '🧱', label: 'New job', hint: 'name + price', prompt: "I want to set up a new job. Ask me for what you need one question at a time." },
  { icon: '👷', label: 'Add a worker', hint: 'name + pay rate', prompt: "I want to add a guy to my crew and set what I pay him. Ask me for what you need one question at a time." },
  { icon: '🧾', label: 'Add a receipt', hint: 'snap a photo', action: 'receipt' },
  { icon: '⏱', label: 'Log crew hours', hint: 'who, job, hours', prompt: "I want to log hours for one of my guys. Ask me for what you need one question at a time." },
  { icon: '💵', label: 'Send an invoice', hint: 'job + amount', prompt: "I want to bill a client. Ask me for what you need one question at a time." },
  { icon: '📊', label: 'Where do I stand?', hint: 'profit + owed', prompt: "Where do I stand right now — profit so far and what am I owed?" },
]
const CREW_TEMPLATES = [
  { icon: '⏱', label: 'Clock in', hint: 'start the day', prompt: 'Clock me in.' },
  { icon: '🛑', label: 'Clock out', hint: 'end the day', prompt: 'Clock me out.' },
  { icon: '🧾', label: 'Add a receipt', hint: 'snap a photo', action: 'receipt' },
  { icon: '📅', label: 'My hours', hint: 'this week', prompt: 'How many hours do I have this week?' },
  { icon: '🌴', label: 'Time off', hint: 'ask the boss', prompt: "I want to request time off. Ask me for what you need one question at a time." },
]

// Two looks, one list: big tappable cards on the empty chat (nothing else to
// look at), then a thin scrolling row above the keyboard once the conversation
// has started (so it never pushes the messages off a phone screen).
function Templates({ items, compact, disabled, onPick }) {
  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px 0', overflowX: 'auto', background: 'white', WebkitOverflowScrolling: 'touch' }}>
        {items.map((t) => (
          <button
            key={t.label}
            onClick={() => onPick(t)}
            disabled={disabled}
            style={{ flex: '0 0 auto', padding: '7px 12px', borderRadius: 999, border: '1px solid #d1d5db', background: 'white', color: NAVY, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', opacity: disabled ? 0.5 : 1 }}
          >
            <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#9ca3af', letterSpacing: 0.5, marginBottom: 8 }}>TAP ONE TO START</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {items.map((t) => (
          <button
            key={t.label}
            onClick={() => onPick(t)}
            disabled={disabled}
            style={{ textAlign: 'left', padding: '12px 12px 11px', borderRadius: 12, border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', opacity: disabled ? 0.5 : 1 }}
          >
            <div style={{ fontSize: 20, lineHeight: 1.1, marginBottom: 5 }}>{t.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{t.label}</div>
            {t.hint && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{t.hint}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const tok = data && data.session && data.session.access_token
  return tok ? { Authorization: `Bearer ${tok}` } : {}
}

export default function AssistantPanel({ onDataChanged, role = 'owner' }) {
  const isOwner = role !== 'worker'
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('chat')
  const [msgs, setMsgs] = useState([
    {
      role: 'assistant',
      // Kept short on purpose — the template cards below it show what it can
      // do far better than a paragraph does. Anything not on a card still
      // works by typing or talking.
      text: isOwner
        ? "Hey — tap one of these, or hit 🎤 and just talk (jobs, money, crew, receipts, invoices, permits, punch lists…). Ask out loud and I'll answer out loud. Nothing saves until you hit Confirm."
        : "Hey — tap one of these, or hit 🎤 and just say it. Ask out loud and I'll answer out loud. Nothing saves until you hit Confirm.",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null) // { tool, args, summary }
  const [activity, setActivity] = useState(null)
  const [listening, setListening] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [speakMode, setSpeakMode] = useState(speakPref)
  const scrollRef = useRef(null)
  const recogRef = useRef(null)
  const fileRef = useRef(null)
  // True while the current turn traces back to the mic. Set when dictation lands
  // text, cleared by any typed/tapped send — and deliberately NOT cleared by the
  // confirm round-trip, so a voice-started action is also confirmed out loud.
  const voiceTurnRef = useRef(false)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, pending, busy])

  const pushMsg = (m) => setMsgs((prev) => [...prev, m])

  const hush = useCallback(() => { try { if (SS) SS.cancel() } catch { /* nothing queued */ } }, [])

  // Speak a reply. Barge-in first: whatever is still playing is cancelled, so a
  // fast second question never stacks up behind the last answer.
  const say = useCallback((text) => {
    if (!SS || speakMode === 'off' || !voiceTurnRef.current) return
    const t = speakable(text)
    if (!t) return
    try {
      SS.cancel()
      const u = new window.SpeechSynthesisUtterance(t)
      u.lang = 'en-US'
      u.rate = 1.02
      SS.speak(u)
    } catch { /* voice is a bonus, never a blocker */ }
  }, [speakMode])

  // Stop talking when the sheet closes or the component goes away — audio that
  // outlives its own UI is the fastest way to make someone distrust the mic.
  useEffect(() => { if (!open) hush() }, [open, hush])
  useEffect(() => hush, [hush])

  const send = useCallback(async (overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!text || busy) return
    // A template tap or a receipt scan is not a spoken turn — it silences
    // talk-back until the mic is used again.
    if (typeof overrideText === 'string') voiceTurnRef.current = false
    else setInput('')
    hush()
    setPending(null)
    pushMsg({ role: 'user', text })
    setBusy(true)
    // Send only prior text turns as history (keeps the tool context fresh).
    const history = msgs
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text))
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.text }))
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ message: text, history, tz: new Date().getTimezoneOffset() }),
      })
      // Parse defensively: a 5xx from Vercel can be an HTML error page, not JSON.
      // Falling through to the connection-error catch would mislabel a server
      // fault as "check your connection."
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { pushMsg({ role: 'assistant', text: data.error || 'Something went wrong.' }); return }
      if (data.type === 'confirm') {
        setPending({ tool: data.tool, args: data.args, summary: data.summary })
        // Read the proposal out loud with the ask attached — otherwise a
        // hands-free user hears what's about to happen and no way to stop it.
        say(`About to: ${data.summary}. Tap confirm to save it, or cancel.`)
        // The confirm card is its own UI, not a bubble — but the model still
        // has to SEE that it already proposed this, or the next turn re-asks
        // for fields it just collected (or re-proposes a cancelled write).
        pushMsg({ role: 'assistant', text: `[proposed for confirmation] ${data.summary}`, hidden: true })
      } else {
        pushMsg({ role: 'assistant', text: data.reply })
        say(data.reply)
      }
    } catch {
      pushMsg({ role: 'assistant', text: "Couldn't reach the assistant. Check your connection." })
    } finally {
      setBusy(false)
    }
  }, [input, busy, msgs, say, hush])

  // Cancel has to leave a trace in the history, otherwise the model only sees
  // an unfinished setup and proposes the exact same write again on the next
  // message — which is what happens the moment someone taps a new template.
  const cancelAction = useCallback(() => {
    if (busy) return
    setPending(null)
    pushMsg({ role: 'user', text: '[cancelled that — do not do it. Move on to what I say next.]', hidden: true })
  }, [busy])

  const confirmAction = useCallback(async () => {
    if (!pending || busy) return
    setBusy(true)
    const p = pending
    setPending(null)
    try {
      const r = await fetch('/api/assistant-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ tool: p.tool, args: p.args, tz: new Date().getTimezoneOffset() }),
      })
      const data = await r.json().catch(() => ({}))
      const outcome = r.ok ? (data.message || 'Done ✓') : (data.error || "Couldn't do that.")
      pushMsg({ role: 'assistant', text: outcome })
      say(outcome)
      if (r.ok) {
        if (typeof onDataChanged === 'function') onDataChanged() // refresh dashboard money after a confirmed write
        if (activity) loadActivity()
      }
    } catch {
      pushMsg({ role: 'assistant', text: "Couldn't complete that action." })
    } finally {
      setBusy(false)
    }
  }, [pending, busy, activity, onDataChanged, say])

  // Mic dictation — browser speech-to-text into the input box. Button only
  // renders when the browser has SpeechRecognition (iOS Safari 14.5+, Chrome).
  const toggleMic = useCallback(() => {
    if (!SR) return
    // Barge-in: stop talking the instant the mic opens, or the assistant's own
    // voice ends up in the transcript.
    hush()
    if (listening) {
      try { if (recogRef.current) recogRef.current.stop() } catch { /* already stopped */ }
      setListening(false)
      return
    }
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = true // live text as they speak, not just at the end
    rec.maxAlternatives = 1
    // Keep whatever they'd already typed; append the dictation live on top of it.
    const base = input ? input.trim() + ' ' : ''
    rec.onresult = (e) => {
      let finalText = ''
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const seg = e.results[i][0] ? e.results[i][0].transcript : ''
        if (e.results[i].isFinal) finalText += seg
        else interim += seg
      }
      // They actually spoke — this turn earns a spoken answer back.
      if (finalText.trim()) voiceTurnRef.current = true
      setInput((base + (finalText + interim)).replace(/\s+/g, ' ').trimStart())
    }
    rec.onend = () => setListening(false)
    rec.onerror = (e) => {
      setListening(false)
      voiceTurnRef.current = false
      const err = e && e.error
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        pushMsg({ role: 'assistant', text: 'I need microphone access to hear you — allow the mic for this site in your browser settings, then tap 🎤 again. You can always just type instead.' })
      } else if (err === 'no-speech') {
        pushMsg({ role: 'assistant', text: "Didn't catch anything — tap 🎤 and speak, or just type it." })
      } else if (err === 'audio-capture') {
        pushMsg({ role: 'assistant', text: "Can't find a microphone on this device — go ahead and type it instead." })
      }
    }
    recogRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch { setListening(false) }
  }, [listening, input, hush])

  // Receipt photo (owner or crew): photo → /api/scan-receipt (Haiku vision) →
  // auto-send the store/amount/date so the normal add_expense confirm flow takes
  // over. `amount` is the PRE-TAX subtotal and `tax` is the sales tax, which is
  // exactly what add_expense wants (it books cost = amount + sales_tax). The
  // sentence below has to say so in words, because the model — not this code —
  // is what fills in the tool call. A crew scan books to the boss's records
  // server-side.
  const onReceiptPick = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || busy || scanning) return
    if (!RECEIPT_TYPES.includes(file.type)) {
      pushMsg({ role: 'assistant', text: 'That file type won’t work — send a photo (JPG, PNG, or WebP).' })
      return
    }
    setScanning(true)
    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] || '')
        r.onerror = reject
        r.readAsDataURL(file)
      })
      const resp = await fetch('/api/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ imageBase64: b64, mediaType: file.type }),
      })
      const data = await resp.json().catch(() => null)
      const store = data && data.store ? String(data.store).slice(0, 80) : ''
      const amount = data && Number(data.amount) > 0 ? Number(data.amount).toFixed(2) : ''
      // date is YYYY-MM-DD or null; tax is a number string or null (both optional).
      const date = data && /^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '')) ? data.date : ''
      const tax = data && Number(data.tax) > 0 ? Number(data.tax).toFixed(2) : ''
      if (!resp.ok || (!store && !amount)) {
        pushMsg({ role: 'assistant', text: (data && data.error) || 'Couldn’t read that receipt — try a clearer photo, or just tell me the store and amount.' })
        return
      }
      setScanning(false)
      // Spelled out as subtotal + tax, never as a single "total". add_expense
      // takes the pre-tax figure in `amount` and the tax separately; a sentence
      // that says "$108 total (includes $8 tax)" invites the model to put 108
      // in amount and 8 in sales_tax, which bills the job $116.
      await send(
        `I scanned a receipt${store ? ` from ${store}` : ''}` +
        (amount
          ? (tax
            ? ` — $${amount} before tax plus $${tax} sales tax`
            : ` for $${amount} (no sales tax on it)`)
          : '') +
        `${date ? `, dated ${date}` : ''}. ` +
        `Add it as an expense: amount $${amount}${tax ? `, sales tax $${tax}` : ''}. ` +
        `Ask me which job if you need to.`
      )
    } catch {
      pushMsg({ role: 'assistant', text: 'Couldn’t read that receipt. Tell me the store and amount instead.' })
    } finally {
      setScanning(false)
    }
  }, [busy, scanning, send])

  // A template chip is either "open the camera" or "say this for me".
  const templates = isOwner ? OWNER_TEMPLATES : CREW_TEMPLATES
  const pickTemplate = useCallback((t) => {
    if (busy || scanning) return
    if (t.action === 'receipt') { if (fileRef.current) fileRef.current.click(); return }
    send(t.prompt)
  }, [busy, scanning, send])

  const loadActivity = useCallback(async () => {
    const { data, error } = await supabase
      .from('assistant_actions')
      .select('action, params, status, result, created_at, actor_role')
      .order('created_at', { ascending: false })
      .limit(25)
    setActivity(error ? [] : (data || []))
  }, [])

  useEffect(() => { if (open && tab === 'activity' && activity === null) loadActivity() }, [open, tab, activity, loadActivity])

  const ACTION_LABELS = {
    add_expense: 'Added expense', create_job: 'Created job', update_job: 'Updated job', set_job_stage: 'Changed job stage',
    add_time_entry: 'Logged hours', add_mileage: 'Logged mileage', add_daily_log: 'Added daily log',
    add_change_order: 'Added extra', add_punch_item: 'Added punch item', set_punch_item: 'Updated punch item',
    add_material_item: 'Added material', set_material_item: 'Updated material',
    create_invoice: 'Created invoice', mark_invoice_paid: 'Marked invoice paid',
    create_estimate: 'Created estimate', set_estimate_status: 'Updated estimate', accept_estimate: 'Accepted estimate',
    set_worker_rate: 'Set worker rate', assign_worker: 'Assigned worker', decide_time_off: 'Decided time off',
    add_schedule_entry: 'Scheduled shift', record_paycheck: 'Recorded paycheck',
    add_permit: 'Added permit', set_permit_status: 'Updated permit',
    add_warranty: 'Logged callback', set_warranty_status: 'Updated callback',
    add_compliance_item: 'Added document', update_settings: 'Updated settings',
    invite_worker: 'Invited worker', remove_worker: 'Removed worker',
    clock_in: 'Clocked in', clock_out: 'Clocked out', request_time_off: 'Requested time off',
  }
  const describe = (a) => {
    const p = a.params || {}
    const label = ACTION_LABELS[a.action] || String(a.action || '').replace(/_/g, ' ')
    if (a.action === 'add_expense') return `Added $${Number(p.amount || 0).toFixed(2)} ${p.category || 'materials'} to “${p.job_name || '—'}”`
    const target = p.job_name || p.worker_name || p.name || p.title || p.label || p.description
    return target ? `${label} — ${String(target).slice(0, 60)}` : label
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        style={{
          position: 'fixed', right: 16, bottom: 'calc(84px + env(safe-area-inset-bottom))', zIndex: 900,
          width: 56, height: 56, borderRadius: 28, border: 'none',
          background: ORANGE, color: 'white', fontSize: 24, cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
        }}
      >✨</button>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 950, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.4)' }} onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#F7F8FA', borderTopLeftRadius: 18, borderTopRightRadius: 18, height: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ background: NAVY, color: 'white', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <strong style={{ fontSize: 16 }}>JobTally Assistant</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {SS && (
              <button
                onClick={() => { const next = speakMode === 'off' ? 'auto' : 'off'; setSpeakMode(next); try { localStorage.setItem(SPEAK_KEY, next) } catch { /* private mode */ } if (next === 'off') hush() }}
                aria-label={speakMode === 'off' ? 'Turn on spoken answers' : 'Turn off spoken answers'}
                title={speakMode === 'off' ? 'Spoken answers off' : 'Speaks back when you use the mic'}
                style={{ background: 'transparent', border: 'none', color: 'white', fontSize: 17, cursor: 'pointer', opacity: speakMode === 'off' ? 0.45 : 1, padding: '0 4px' }}
              >{speakMode === 'off' ? '🔇' : '🔊'}</button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
        </div>
        {/* tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', background: 'white' }}>
          {['chat', 'activity'].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '10px', border: 'none', background: 'transparent', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: tab === t ? ORANGE : '#6b7280', borderBottom: tab === t ? `2px solid ${ORANGE}` : '2px solid transparent' }}>
              {t === 'chat' ? 'Chat' : 'Activity'}
            </button>
          ))}
        </div>

        {tab === 'chat' ? (
          <>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {msgs.map((m, i) => m.hidden ? null : (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.role === 'user' ? ORANGE : 'white', color: m.role === 'user' ? 'white' : NAVY, padding: '10px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  {m.text}
                </div>
              ))}
              {/* Nothing said yet → show the whole menu of what it can do. */}
              {msgs.length <= 1 && !pending && (
                <Templates items={templates} disabled={busy || scanning} onPick={pickTemplate} />
              )}
              {pending && (
                <div style={{ alignSelf: 'flex-start', maxWidth: '92%', background: '#FFF4ED', border: `1px solid ${ORANGE}`, borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: ORANGE, marginBottom: 4, letterSpacing: 0.3 }}>ABOUT TO:</div>
                  <div style={{ fontSize: 14, color: NAVY, marginBottom: 10 }}>{pending.summary}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={confirmAction} disabled={busy} style={{ flex: 1, padding: '9px', border: 'none', borderRadius: 9, background: ORANGE, color: 'white', fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                    <button onClick={cancelAction} disabled={busy} style={{ flex: 1, padding: '9px', border: '1px solid #d1d5db', borderRadius: 9, background: 'white', color: NAVY, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              )}
              {(busy || scanning) && <div style={{ alignSelf: 'flex-start', color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>{scanning ? 'reading receipt…' : 'thinking…'}</div>}
            </div>
            {/* Mid-conversation the same list rides above the keyboard as a thin
                scrolling row. Hidden while a Confirm card is up — one decision
                on screen at a time. */}
            {msgs.length > 1 && !pending && (
              <div style={{ borderTop: '1px solid #e5e7eb' }}>
                <Templates items={templates} compact disabled={busy || scanning} onPick={pickTemplate} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, padding: 12, paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', borderTop: msgs.length > 1 && !pending ? 'none' : '1px solid #e5e7eb', background: 'white' }}>
              {/* Receipt scan — owner and crew both; a crew scan books to the boss server-side. */}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onReceiptPick} style={{ display: 'none' }} />
              <button onClick={() => { if (fileRef.current) fileRef.current.click() }} disabled={busy || scanning} aria-label="Scan a receipt" title="Scan a receipt" style={{ width: 44, border: '1px solid #d1d5db', borderRadius: 10, background: 'white', fontSize: 18, cursor: 'pointer' }}>🧾</button>
              {SR && (
                <button onClick={toggleMic} disabled={busy || scanning} aria-label={listening ? 'Stop listening' : 'Speak'} title={listening ? 'Stop listening' : 'Speak'} style={{ width: 44, border: listening ? 'none' : '1px solid #d1d5db', borderRadius: 10, background: listening ? '#dc2626' : 'white', fontSize: 18, cursor: 'pointer' }}>🎤</button>
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send() }}
                placeholder={listening ? 'Listening…' : isOwner ? 'Ask or tell me to do something…' : 'Clock in, check hours, time off…'}
                style={{ flex: 1, minWidth: 0, padding: '11px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 15, outline: 'none' }}
              />
              <button onClick={send} disabled={busy || !input.trim()} style={{ padding: '0 16px', border: 'none', borderRadius: 10, background: input.trim() && !busy ? ORANGE : '#d1d5db', color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Send</button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {activity === null ? (
              <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div>
            ) : activity.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 14, textAlign: 'center', marginTop: 30 }}>No assistant actions yet.<br />Anything the assistant does will show here.</div>
            ) : (
              activity.map((a, i) => (
                <div key={i} style={{ background: 'white', borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: 14, color: NAVY, fontWeight: 600 }}>{describe(a)}</div>
                  <div style={{ fontSize: 11, color: a.status === 'executed' ? '#16A34A' : '#dc2626', marginTop: 3, fontWeight: 700 }}>
                    {a.status === 'executed' ? '✓ done' : '✕ ' + (a.status || 'failed')}
                    <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {a.actor_role || 'owner'} · {a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
