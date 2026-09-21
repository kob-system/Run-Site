import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { toJpeg, imageErrorMessage, jpegName } from '../utils/imageToJpeg'
import { pickReceiptJob, orderJobsForPicker, guessCategory } from '../utils/receiptJob'

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
// v0.7: a receipt PHOTO rides with the message. Pick one (camera or library),
// say or type which job, Send. The card shows the photo, the numbers read off
// it and a job picker, every field fixable. The photo is uploaded only when
// Confirm is tapped, so Cancel leaves nothing behind in storage.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
const SS = typeof window !== 'undefined' ? window.speechSynthesis : null

// 0:07, 1:42. A number that moves is the only proof a mic is really on;
// "Listening…" sits there looking identical whether it works or not.
function mmss(total) {
  const s = Math.max(0, Math.floor(total))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

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
function speakable(text, full) {
  if (!text) return ''
  let t = String(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[*_`#>]/g, ' ')
    .replace(/[•–—]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!full && t.length > 320) {
    const cut = t.slice(0, 320)
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    t = stop > 120 ? cut.slice(0, stop + 1) : cut + '…'
  }
  return t
}

// Tap-a-template starters. A chip does nothing clever — it just sends a plain
// English opener, so the assistant runs its normal flow and the usual Confirm
// card is still the last thing before anything saves. Nobody has to know what
// to type; the app tells them what it can do.
//
// Every one of these used to end with "Ask me for what you need one question at
// a time." That single sentence turned the assistant into an interrogation: a
// man in a truck who says "put Dave on the Maple job, eight hours yesterday"
// got asked which worker, then which job, then which day, then how long — four
// round trips for a sentence that already had all four answers in it.
//
// So the chip now says the thing OUT LOUD instead: "say it all in one go."
// api/assistant.js already handles a whole batch in one turn (SAY IT ALL IN ONE
// BREATH) — the templates were the only thing fighting it.
const SAY_IT_ALL = "Say it all in one go if you want — I'll fill in everything you gave me and only ask if something's genuinely missing."
const OWNER_TEMPLATES = [
  { icon: '🧱', label: 'New job', hint: 'name + price', prompt: "I want to set up a new job. " + SAY_IT_ALL },
  { icon: '👷', label: 'Add a worker', hint: 'name + pay rate', prompt: "I want to add a guy to my crew and set what I pay him. " + SAY_IT_ALL },
  { icon: '🧾', label: 'Add a receipt', hint: 'snap a photo', action: 'receipt' },
  { icon: '⏱', label: 'Log crew hours', hint: 'who, job, hours', prompt: "I want to log hours for my guys. " + SAY_IT_ALL },
  { icon: '💵', label: 'Send an invoice', hint: 'job + amount', prompt: "I want to bill a client. " + SAY_IT_ALL },
  { icon: '📊', label: 'Where do I stand?', hint: 'profit + owed', prompt: "Where do I stand right now — profit so far and what am I owed?" },
]
const CREW_TEMPLATES = [
  { icon: '⏱', label: 'Clock in', hint: 'start the day', prompt: 'Clock me in.' },
  { icon: '🛑', label: 'Clock out', hint: 'end the day', prompt: 'Clock me out.' },
  { icon: '🧾', label: 'Add a receipt', hint: 'snap a photo', action: 'receipt' },
  { icon: '📅', label: 'My hours', hint: 'this week', prompt: 'How many hours do I have this week?' },
  { icon: '🌴', label: 'Time off', hint: 'ask the boss', prompt: "I want to request time off. " + SAY_IT_ALL },
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

// ---- Receipt photos -------------------------------------------------------
// Same buckets and labels as the Add Receipt sheet in OwnerDashboard.js.
const CATEGORY_LABELS = {
  materials: 'Materials', fuel: 'Fuel / Gas', tools: 'Tools', permits: 'Permits',
  subcontractor: 'Subcontractor', supplies: 'Supplies', insurance: 'Insurance', meals: 'Meals', other: 'Other',
}
const RECEIPT_CATEGORIES = Object.keys(CATEGORY_LABELS)
const moneyStr = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// The one thing stopping the receipt card from saving, or '' when it can.
function receiptProblem(r) {
  if (!r.projectId) return 'Pick the job this receipt goes on.'
  if (!(toNum(r.amount) > 0)) return 'Put in the amount before tax.'
  if (toNum(r.amount) > 100000) return 'That amount looks too big. Check it.'
  if (toNum(r.tax) < 0) return "The tax can't be negative."
  if (toNum(r.tax) > 0 && toNum(r.tax) >= toNum(r.amount)) return "The tax can't be more than the amount before tax."
  return ''
}

function receiptSummary(r) {
  const job = (r.jobs || []).find((j) => j.id === r.projectId)
  const total = toNum(r.amount) + Math.max(0, toNum(r.tax))
  return `Add a ${moneyStr(total)} receipt${r.store ? ` from ${r.store}` : ''}${job ? ` to “${job.name}”` : ''}, with the photo`
}

// photo -> /api/scan-receipt (Haiku vision). `amount` is the PRE-TAX subtotal
// and `tax` the sales tax: exactly the pair add_expense books (cost = amount +
// tax). Never a lone "total", or the tax gets counted twice.
async function scanReceiptImage(base64) {
  const resp = await fetch('/api/scan-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ imageBase64: base64, mediaType: 'image/jpeg' }),
  })
  const data = await resp.json().catch(() => null)
  if (!resp.ok) return { error: (data && data.error) || 'scan failed' }
  return {
    store: data && data.store ? String(data.store).slice(0, 80) : '',
    amount: data && Number(data.amount) > 0 ? Number(data.amount).toFixed(2) : '',
    tax: data && Number(data.tax) > 0 ? Number(data.tax).toFixed(2) : '',
    total: data && Number(data.total) > 0 ? Number(data.total).toFixed(2) : '',
    date: data && /^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '')) ? data.date : '',
  }
}

// Every job the card can offer, under the caller's own RLS. An owner sees his
// jobs; a crew member only the ones he's on (the worker_projects view).
async function loadReceiptJobs(isOwner) {
  if (isOwner) {
    let res = await supabase.from('projects').select('id,name,stage,is_sample').order('created_at', { ascending: false }).limit(200)
    // is_sample came with FIX-DATABASE-24; a database without it still lists jobs.
    if (res.error) res = await supabase.from('projects').select('id,name,stage').order('created_at', { ascending: false }).limit(200)
    if (res.error) throw res.error
    return orderJobsForPicker(res.data)
  }
  const res = await supabase.from('worker_projects').select('id,name')
  if (res.error) throw res.error
  return orderJobsForPicker(res.data)
}

// The confirm card for a receipt photo. Everything on it can be fixed before
// it saves: a misread total, the wrong day, the job. When the job isn't clear
// the picker starts empty and Confirm stays off until he picks one.
function ReceiptCard({ receipt: r, busy, onChange, onConfirm, onCancel }) {
  const problem = receiptProblem(r)
  const amount = toNum(r.amount)
  const tax = Math.max(0, toNum(r.tax))
  const field = { width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 16, background: 'white', color: NAVY }
  const label = { display: 'block', fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }
  const jobs = r.jobs || []
  return (
    <div style={{ alignSelf: 'stretch', background: '#FFF4ED', border: `1px solid ${ORANGE}`, borderRadius: 14, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: ORANGE, marginBottom: 8, letterSpacing: 0.3 }}>ABOUT TO ADD THIS RECEIPT:</div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <img src={r.previewUrl} alt="Receipt photo" style={{ width: 84, height: 112, objectFit: 'cover', borderRadius: 10, border: '1px solid #e5e7eb', flexShrink: 0, background: 'white' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, overflowWrap: 'anywhere' }}>{r.store || 'Store not read'}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: NAVY, marginTop: 2 }}>{moneyStr(amount + tax)}</div>
          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>{moneyStr(amount)} before tax{tax > 0 ? ` + ${moneyStr(tax)} tax` : ', no tax'}</div>
          {r.date && <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>Dated {r.date}</div>}
          <div style={{ fontSize: 13, color: '#4b5563', marginTop: 2 }}>{CATEGORY_LABELS[r.category] || 'Materials'}</div>
        </div>
      </div>
      {r.readFailed && (
        <div style={{ fontSize: 13, color: '#b45309', fontWeight: 700, marginBottom: 8 }}>Couldn't read the numbers off this one. Type them in below.</div>
      )}
      <label style={label} htmlFor="rc-job">Which job?</label>
      <select
        id="rc-job"
        value={r.projectId}
        onChange={(e) => onChange('projectId', e.target.value)}
        style={{ ...field, fontWeight: 700, border: r.projectId ? field.border : `2px solid ${ORANGE}` }}
      >
        <option value="">{jobs.length ? 'Pick the job…' : 'No jobs to pick'}</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}{j.stage === 'end' ? ' (done)' : ''}</option>)}
      </select>
      {r.jobsFailed && <div style={{ fontSize: 13, color: '#b91c1c', fontWeight: 700, marginTop: 6 }}>Couldn't load your jobs. Cancel and try again when you have signal.</div>}
      {!r.jobsFailed && !jobs.length && <div style={{ fontSize: 13, color: '#b91c1c', fontWeight: 700, marginTop: 6 }}>There's no job to put this on yet. Make the job first, then add the receipt.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label} htmlFor="rc-store">Store</label>
          <input id="rc-store" value={r.store} onChange={(e) => onChange('store', e.target.value)} placeholder="Home Depot" style={field} />
        </div>
        <div>
          <label style={label} htmlFor="rc-amount">Before tax ($)</label>
          <input id="rc-amount" type="number" inputMode="decimal" value={r.amount} onChange={(e) => onChange('amount', e.target.value)} placeholder="0.00" style={field} />
        </div>
        <div>
          <label style={label} htmlFor="rc-tax">Sales tax ($)</label>
          <input id="rc-tax" type="number" inputMode="decimal" value={r.tax} onChange={(e) => onChange('tax', e.target.value)} placeholder="0.00" style={field} />
        </div>
        <div>
          <label style={label} htmlFor="rc-date">Date on it</label>
          <input id="rc-date" type="date" value={r.date} onChange={(e) => onChange('date', e.target.value)} style={field} />
        </div>
        <div>
          <label style={label} htmlFor="rc-cat">Category</label>
          <select id="rc-cat" value={r.category} onChange={(e) => onChange('category', e.target.value)} style={field}>
            {RECEIPT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
      </div>
      {problem && <div style={{ fontSize: 13, color: '#b91c1c', fontWeight: 700, marginTop: 10 }}>{problem}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onConfirm} disabled={busy || !!problem} style={{ flex: 1, minHeight: 48, border: 'none', borderRadius: 10, background: ORANGE, color: 'white', fontWeight: 800, fontSize: 16, cursor: 'pointer', opacity: busy || problem ? 0.5 : 1 }}>Confirm</button>
        <button onClick={onCancel} disabled={busy} style={{ flex: 1, minHeight: 48, border: '1px solid #d1d5db', borderRadius: 10, background: 'white', color: NAVY, fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  )
}

// `open` + `onOpenChange` make this a CONTROLLED panel — the owner's bottom nav
// owns the ✨ button now, because talking to it is meant to read as a place you
// go, not a helper hovering over the screen you're already on. Left uncontrolled
// (the crew side) it keeps its own floating button and behaves exactly as before.
// `projectId` = the job he opened this from (Talk it out). It goes to the
// server with every message and preselects the job on a receipt card.
// `ownerId` = the crew side's boss. A crew receipt photo is stored in the
// boss's folder, the same way crew job photos are.
export default function AssistantPanel({ onDataChanged, role = 'owner', open: openProp, onOpenChange, autoTalk = false, projectId = null, ownerId = null }) {
  const isOwner = role !== 'worker'
  const controlled = typeof openProp === 'boolean'
  const [openState, setOpenState] = useState(false)
  const open = controlled ? openProp : openState
  const setOpen = useCallback((v) => {
    if (controlled) { if (onOpenChange) onOpenChange(v) } else setOpenState(v)
  }, [controlled, onOpenChange])
  const [tab, setTab] = useState('chat')
  const [msgs, setMsgs] = useState([
    {
      role: 'assistant',
      // Kept short on purpose — the template cards below it show what it can
      // do far better than a paragraph does. Anything not on a card still
      // works by typing or talking.
      text: isOwner
        ? "Hey — hit the big 🎤 and say the whole thing in one go: the job, the guys, the hours, what you spent, what you still need. It keeps listening while you think, until you tap stop. I'll sort it into the right places. Nothing saves until you hit Confirm."
        : "Hey — hit the big 🎤 and just say it, all in one go. It keeps listening while you think, until you tap stop. Ask out loud and I'll answer out loud. Nothing saves until you hit Confirm.",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null) // { tool, args, summary }
  const [activity, setActivity] = useState(null)
  const [listening, setListening] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [speakMode, setSpeakMode] = useState(speakPref)
  // A receipt photo waiting in the tray above the composer:
  // { blob, previewUrl, name, scan } where scan is undefined while reading.
  const [attach, setAttach] = useState(null)
  const scanPromiseRef = useRef(null)
  // Every preview URL made, so they are all let go when the panel unmounts.
  const urlsRef = useRef([])
  useEffect(() => () => { urlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u) } catch { /* gone */ } }) }, [])
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
  // `full` skips the length trim. Trimming a chatty ANSWER is a kindness;
  // trimming the read-back of what is about to SAVE is not — a four-action
  // batch cut after the second one means he confirms two things he never heard.
  const say = useCallback((text, full) => {
    if (!SS || speakMode === 'off' || !voiceTurnRef.current) return
    const t = speakable(text, full)
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

  // A receipt photo plus whatever he said with it becomes a receipt card.
  // This never calls the model: the numbers come off the scan, the job comes
  // from the job he opened this from, the job his note names, or his only live
  // job, and otherwise he picks. Nothing is uploaded or saved here.
  const proposeReceipt = useCallback(async (staged, note) => {
    setAttach(null)
    setPending(null)
    pushMsg({ role: 'user', text: note || 'Receipt photo', image: staged.previewUrl })
    setBusy(true)
    try {
      const scanP = staged.scan !== undefined ? Promise.resolve(staged.scan) : (scanPromiseRef.current || Promise.resolve(null))
      const [scan, jobsRes] = await Promise.all([
        scanP.catch(() => null),
        loadReceiptJobs(isOwner).then((jobs) => ({ jobs }), () => ({ jobs: [], failed: true })),
      ])
      const s = scan && !scan.error ? scan : {}
      const pick = jobsRes.failed ? null : pickReceiptJob({ jobs: jobsRes.jobs, note, projectId })
      const receipt = {
        blob: staged.blob,
        previewUrl: staged.previewUrl,
        name: staged.name,
        store: s.store || '',
        amount: s.amount || '',
        tax: s.tax || '',
        date: s.date || '',
        category: guessCategory(note),
        projectId: pick ? pick.id : '',
        jobs: jobsRes.jobs,
        jobsFailed: !!jobsRes.failed,
        readFailed: !(s.store || s.amount),
      }
      const summary = receiptSummary(receipt)
      setPending({ kind: 'receipt', receipt, summary })
      say(receipt.projectId
        ? `About to: ${summary}. Tap confirm to save it, or cancel.`
        : 'I read the receipt. Pick which job it goes on, then tap confirm.', true)
      pushMsg({ role: 'assistant', text: `[proposed for confirmation] ${summary}`, hidden: true })
    } finally {
      setBusy(false)
    }
  }, [isOwner, projectId, say])

  const updateReceipt = useCallback((field, value) => {
    setPending((p) => {
      if (!p || p.kind !== 'receipt') return p
      const receipt = { ...p.receipt, [field]: value }
      return { ...p, receipt, summary: receiptSummary(receipt) }
    })
  }, [])

  const removeAttach = useCallback(() => {
    setAttach(null)
    scanPromiseRef.current = null
  }, [])

  const send = useCallback(async (overrideText, keepVoice) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    // A receipt photo in the tray can go with no words at all.
    const staged = attach
    if ((!text && !staged) || busy) return
    // A template tap or a receipt scan is not a spoken turn — it silences
    // talk-back until the mic is used again. `keepVoice` is the exception:
    // press-and-hold sends override text and IS a spoken turn.
    if (typeof overrideText === 'string' && !keepVoice) voiceTurnRef.current = false
    else setInput('')
    hush()
    // THE RULE THAT MAKES THE MIC TRUSTWORTHY.
    // Whatever he said goes into the job's thread verbatim, before the model
    // has looked at it and whatever the model decides to do with it. If the
    // routing gets it wrong, that costs a tap to fix. It must never cost the
    // note. Fire-and-forget: this can fail silently, the ask still goes.
    if (text && projectId && (keepVoice || voiceTurnRef.current)) {
      supabase.rpc('post_job_message', { p_project_id: projectId, p_body: text })
        .then(() => {}, () => {})
    }
    // A photo in the tray means this message is about THAT receipt: the words,
    // if any, are the note ("for the Smith deck"). It becomes a receipt card.
    if (staged) { await proposeReceipt(staged, text); return }
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
        // project_id: the job on screen, so "add 2x4s to the buy list" from
        // inside a job lands on that job without a "which job?" round trip.
        body: JSON.stringify({ message: text, history, tz: new Date().getTimezoneOffset(), ...(projectId ? { project_id: projectId } : {}) }),
      })
      // Parse defensively: a 5xx from Vercel can be an HTML error page, not JSON.
      // Falling through to the connection-error catch would mislabel a server
      // fault as "check your connection."
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { pushMsg({ role: 'assistant', text: data.error || 'Something went wrong.' }); return }
      if (data.type === 'confirm') {
        setPending({
          tool: data.tool,
          args: data.args,
          // Several writes can ride on one card. Older server builds send only
          // tool/args, so fall back to a one-item list rather than assuming.
          actions: Array.isArray(data.actions) && data.actions.length
            ? data.actions
            : [{ tool: data.tool, args: data.args, summary: data.summary }],
          summary: data.summary,
        })
        // Read the proposal out loud with the ask attached — otherwise a
        // hands-free user hears what's about to happen and no way to stop it.
        // Spoken read-back. A hands-free user has to hear everything that is
        // about to save — a batch counted out loud, not run together, so he can
        // tell three things from four before he taps.
        const list = Array.isArray(data.actions) ? data.actions : []
        say(list.length > 1
          ? `About to do ${list.length} things. ` +
            list.map((a, i) => `${i + 1}. ${a.summary}.`).join(' ') +
            ' Tap confirm to save all of it, or cancel.'
          : `About to: ${data.summary}. Tap confirm to save it, or cancel.`, true)
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
  }, [input, busy, msgs, say, hush, projectId, attach, proposeReceipt])

  // Cancel has to leave a trace in the history, otherwise the model only sees
  // an unfinished setup and proposes the exact same write again on the next
  // message — which is what happens the moment someone taps a new template.
  const cancelAction = useCallback(() => {
    if (busy) return
    setPending(null)
    pushMsg({ role: 'user', text: '[cancelled that — do not do it. Move on to what I say next.]', hidden: true })
  }, [busy])

  // Confirm on a receipt card. Upload FIRST, then save, so a receipt row never
  // points at a photo that isn't there. If the upload fails nothing is saved
  // and the card comes straight back, so one more tap retries it.
  const confirmReceipt = useCallback(async () => {
    const p = pending
    if (!p || p.kind !== 'receipt' || busy) return
    const r = p.receipt
    if (receiptProblem(r)) return
    setBusy(true)
    setPending(null)
    let path = null
    try {
      const { data } = await supabase.auth.getSession()
      const session = data && data.session
      const uid = session && session.user && session.user.id
      // Owner: his own folder, the exact shape the Add Receipt sheet uses.
      // Crew: the boss's folder under receipts/ (storage lets an assigned
      // worker write there, and the boss reads it like any receipt of his).
      let folder = null
      if (isOwner) {
        folder = uid ? `${uid}/` : null
      } else {
        let boss = ownerId
        if (!boss && uid) {
          const { data: me } = await supabase.from('profiles').select('owner_id').eq('id', uid).maybeSingle()
          boss = me && me.owner_id
        }
        folder = boss ? `${boss}/receipts/` : null
      }
      if (!folder) throw new Error('no storage folder')
      path = `${folder}${Date.now()}_${r.name || 'receipt.jpg'}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, r.blob, { contentType: 'image/jpeg' })
      if (upErr) throw upErr
    } catch {
      setPending(p)
      pushMsg({ role: 'assistant', text: "Couldn't upload the photo, so nothing was saved. Check your signal and tap Confirm again." })
      setBusy(false)
      return
    }
    const job = (r.jobs || []).find((j) => j.id === r.projectId)
    const args = {
      project_id: r.projectId,
      job_name: job ? job.name : '',
      amount: round2(toNum(r.amount)),
      category: r.category || 'materials',
      photo_path: path,
    }
    if (toNum(r.tax) > 0) args.sales_tax = round2(toNum(r.tax))
    if (r.store && r.store.trim()) args.store = r.store.trim().slice(0, 120)
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) args.purchase_date = r.date
    try {
      const resp = await fetch('/api/assistant-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ actions: [{ tool: 'add_expense', args }], tool: 'add_expense', args, tz: new Date().getTimezoneOffset() }),
      })
      const data = await resp.json().catch(() => ({}))
      const outcome = resp.ok ? (data.message || 'Done ✓') : (data.error || "Couldn't save that receipt.")
      pushMsg({ role: 'assistant', text: outcome })
      say(outcome, true)
      if (resp.ok) {
        if (typeof onDataChanged === 'function') onDataChanged()
        if (activity) loadActivity()
      } else {
        // The save was refused, so the photo belongs to nothing. Best effort:
        // storage may not allow the delete, and that is not worth a second error.
        supabase.storage.from('receipts').remove([path]).then(() => {}, () => {})
      }
    } catch {
      pushMsg({ role: 'assistant', text: "Couldn't reach the server, so that receipt may not have saved. Check the job before adding it again." })
    } finally {
      setBusy(false)
    }
  }, [pending, busy, isOwner, ownerId, activity, onDataChanged, say])

  const confirmAction = useCallback(async () => {
    if (!pending || busy) return
    if (pending.kind === 'receipt') { await confirmReceipt(); return }
    setBusy(true)
    const p = pending
    setPending(null)
    try {
      const r = await fetch('/api/assistant-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        // Send both shapes: `actions` is what the server runs, tool/args keeps
        // an older deployed function working if the bundle is ahead of it.
        body: JSON.stringify({
          actions: (p.actions || []).map((a) => ({ tool: a.tool, args: a.args })),
          tool: p.tool,
          args: p.args,
          tz: new Date().getTimezoneOffset(),
        }),
      })
      const data = await r.json().catch(() => ({}))
      const outcome = r.ok ? (data.message || 'Done ✓') : (data.error || "Couldn't do that.")
      pushMsg({ role: 'assistant', text: outcome })
      // Full length again: when a batch stops halfway, what saved and what
      // didn't is the single most important thing he can hear.
      say(outcome, true)
      if (r.ok) {
        if (typeof onDataChanged === 'function') onDataChanged() // refresh dashboard money after a confirmed write
        if (activity) loadActivity()
      }
    } catch {
      pushMsg({ role: 'assistant', text: "Couldn't complete that action." })
    } finally {
      setBusy(false)
    }
  }, [pending, busy, activity, onDataChanged, say, confirmReceipt])

  // ---------------------------------------------------------------------
  // ONE BIG BUTTON. TAP IT, TALK, TAP IT AGAIN.
  //
  // JP, 2026-08-31: "it says hold the star button to talk, but when I hit it,
  // it disappears... the way it works is clunky. I don't want it to have to ask
  // for each one of the pieces of information bit by bit. I want it to ask for
  // the whole pile."
  //
  // Two different things were making it bit-by-bit. Both are fixed here.
  //
  // 1. THE HOLD IS GONE. The button he was told to hold is the orb in the
  //    bottom nav, and this sheet is inset:0 / z-950, so it covers the nav and
  //    the orb with it. The thing the copy named vanished the instant he
  //    touched it. Press-and-hold is deleted outright: the record button lives
  //    IN the sheet, full width, tap on and tap off. Nothing to hold, nothing
  //    to release at the right moment, and it cannot be hidden by the sheet
  //    because it is part of it.
  //
  // 2. THE RECOGNIZER QUIT ON HIM MID-PILE. Web Speech with continuous=false
  //    ends the run at the first real pause, and a man listing four things out
  //    loud pauses between them. That first fragment got sent on its own, the
  //    model answered the fragment, and the whole thing became an
  //    interrogation. Now a run that ends while the button is still armed rolls
  //    the finalized text forward and starts another run. He talks until HE
  //    taps stop; the pauses cost nothing and the model gets the whole pile in
  //    one message.
  //
  // continuous stays FALSE on purpose. It is a documented dead end on iOS
  // (Apple's engine stops on its own, throttles interim results, and misses the
  // first attempt of a session). The restart loop is the supported way to hold
  // a long dictation open there. The recognizer is also CONSTRUCTED when the
  // sheet opens, which loads the engine without asking for the mic, so the
  // first tap is not the dead one.
  // ---------------------------------------------------------------------

  // Hard ceiling on one recording, so a phone left face-up in a truck does not
  // sit there listening. Long enough that nobody talking normally hits it.
  const MAX_TALK_MS = 180000
  // How many runs in a row may end with nothing said before we call it quits.
  // A silent run ends in about 5s, so this is roughly a minute of dead air.
  const MAX_EMPTY_RUNS = 12

  // Live transcript, mirrored into a ref. onend fires with a stale closure over
  // `input`, so the send on stop has to read this instead.
  const dictatedRef = useRef('')
  // Everything finalized by PREVIOUS runs of this recording. Each run's
  // e.results starts empty, so without this a restart erases what he said.
  const baseRef = useRef('')
  // True from the moment he taps record until he taps stop. This is what makes
  // an ended run restart instead of send.
  const recordingRef = useRef(false)
  // Bumped on every new recording. A handler from an older session checks this
  // and does nothing, so a stale onend can never restart a mic he closed.
  const sessionRef = useRef(0)
  const emptyRunsRef = useRef(0)
  const capTimerRef = useRef(null)
  const restartTimerRef = useRef(null)
  // Seconds on the button. He can watch it count, so "is this thing on" is
  // never a question he has to answer by guessing.
  const [talkSecs, setTalkSecs] = useState(0)
  const secsTimerRef = useRef(null)
  // Latest `send`, so onend can call it without re-registering handlers.
  const sendRef = useRef(send)
  useEffect(() => { sendRef.current = send }, [send])

  const buildRecognizer = useCallback(() => {
    if (!SR) return null
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = true // live text as they speak, not just at the end
    rec.maxAlternatives = 1
    // continuous stays FALSE. See the note above.
    return rec
  }, [])

  // Warm the engine the moment the sheet opens. Constructing is enough — it
  // does not ask for the microphone and it does not listen.
  useEffect(() => {
    if (!open || !SR || recogRef.current) return
    recogRef.current = buildRecognizer()
  }, [open, buildRecognizer])

  const clearTalkTimers = useCallback(() => {
    clearTimeout(capTimerRef.current)
    clearTimeout(restartTimerRef.current)
    clearInterval(secsTimerRef.current)
  }, [])

  // Tap stop (or hit the cap, or a dead mic). Ends the session; onend sends.
  // Declared as a ref-backed function because runMic's handlers call it and it
  // in turn depends on nothing they own.
  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return
    recordingRef.current = false
    clearTalkTimers()
    try { if (recogRef.current) recogRef.current.stop() } catch { /* already stopped */ }
  }, [clearTalkTimers])

  // Start ONE run of the recognizer inside an already-open recording session.
  // Called on the first tap and again after every pause-triggered end.
  const runMic = useCallback((mySession) => {
    const rec = recogRef.current || buildRecognizer()
    if (!rec) return false
    recogRef.current = rec

    rec.onresult = (e) => {
      if (sessionRef.current !== mySession) return
      let finalText = ''
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const seg = e.results[i][0] ? e.results[i][0].transcript : ''
        if (e.results[i].isFinal) finalText += seg + ' '
        else interim += seg
      }
      // They actually spoke — this turn earns a spoken answer back.
      if (finalText.trim()) { voiceTurnRef.current = true; emptyRunsRef.current = 0 }
      const composed = (baseRef.current + finalText + interim).replace(/\s+/g, ' ').trimStart()
      dictatedRef.current = composed
      setInput(composed)
    }

    rec.onend = () => {
      if (sessionRef.current !== mySession) return
      // Still armed → that was a pause, not a finish. Bank what he has said so
      // far and open another run. He stops when he taps stop, and not before.
      if (recordingRef.current) {
        baseRef.current = dictatedRef.current ? dictatedRef.current.trim() + ' ' : ''
        emptyRunsRef.current += 1
        if (emptyRunsRef.current > MAX_EMPTY_RUNS) { stopRecording(); return }
        // start() throws if the engine is still winding down, so give it a beat
        // and fall back to a fresh instance the once.
        restartTimerRef.current = setTimeout(() => {
          if (sessionRef.current !== mySession || !recordingRef.current) return
          try { rec.start() } catch {
            const fresh = buildRecognizer()
            if (!fresh) { stopRecording(); return }
            fresh.onresult = rec.onresult; fresh.onend = rec.onend; fresh.onerror = rec.onerror
            recogRef.current = fresh
            try { fresh.start() } catch { stopRecording() }
          }
        }, 150)
        return
      }
      // He tapped stop. The whole pile goes out as ONE message.
      setListening(false)
      clearTalkTimers()
      const text = (dictatedRef.current || '').trim()
      if (text) { voiceTurnRef.current = true; setInput(''); sendRef.current(text, true) }
    }

    rec.onerror = (e) => {
      if (sessionRef.current !== mySession) return
      const err = e && e.error
      // A pause reads as 'no-speech'. While he is still recording that is not
      // an error, it is him thinking — onend restarts and nothing is said.
      if (err === 'no-speech' && recordingRef.current) return
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        recordingRef.current = false
        setListening(false)
        clearTalkTimers()
        voiceTurnRef.current = false
        pushMsg({ role: 'assistant', text: 'I need microphone access to hear you — allow the mic for this site in your browser settings, then tap the 🎤 again. You can always just type instead.' })
      } else if (err === 'audio-capture') {
        recordingRef.current = false
        setListening(false)
        clearTalkTimers()
        voiceTurnRef.current = false
        pushMsg({ role: 'assistant', text: "Can't find a microphone on this device — go ahead and type it instead." })
      }
      // Anything else falls through to onend, which decides restart vs send.
    }

    try {
      rec.start()
      return true
    } catch {
      try {
        const fresh = buildRecognizer()
        if (!fresh) return false
        fresh.onresult = rec.onresult; fresh.onend = rec.onend; fresh.onerror = rec.onerror
        recogRef.current = fresh
        fresh.start()
        return true
      } catch { return false }
    }
  }, [buildRecognizer, clearTalkTimers, stopRecording])

  const startRecording = useCallback(() => {
    if (!SR || recordingRef.current) return
    // Barge-in: stop talking the instant the mic opens, or the assistant's own
    // voice ends up in the transcript.
    hush()
    const mySession = sessionRef.current + 1
    sessionRef.current = mySession
    recordingRef.current = true
    emptyRunsRef.current = 0
    // Keep whatever they'd already typed; append the dictation live on top of it.
    baseRef.current = input ? input.trim() + ' ' : ''
    dictatedRef.current = baseRef.current
    setTalkSecs(0)
    if (!runMic(mySession)) {
      recordingRef.current = false
      pushMsg({ role: 'assistant', text: "Couldn't start the mic just then — tap it again, or type it instead." })
      return
    }
    setListening(true)
    clearInterval(secsTimerRef.current)
    secsTimerRef.current = setInterval(() => setTalkSecs((s) => s + 1), 1000)
    clearTimeout(capTimerRef.current)
    capTimerRef.current = setTimeout(() => stopRecording(), MAX_TALK_MS)
  }, [input, hush, runMic, stopRecording])

  const toggleMic = useCallback(() => {
    if (recordingRef.current) stopRecording()
    else startRecording()
  }, [startRecording, stopRecording])

  // A recording that outlives its own sheet is the fastest way to make someone
  // distrust the mic. Closing the sheet kills it outright.
  useEffect(() => {
    if (open) return
    sessionRef.current += 1
    recordingRef.current = false
    clearTalkTimers()
    setListening(false)
    try { if (recogRef.current) recogRef.current.abort() } catch { /* nothing running */ }
  }, [open, clearTalkTimers])
  useEffect(() => () => {
    sessionRef.current += 1
    recordingRef.current = false
    clearTimeout(capTimerRef.current)
    clearTimeout(restartTimerRef.current)
    clearInterval(secsTimerRef.current)
  }, [])

  // The job's Crew tab opens this sheet already meaning to talk. One shot per
  // open — reopening from the bottom nav must never start recording by itself.
  const autoTalkedRef = useRef(false)
  useEffect(() => {
    if (!open) { autoTalkedRef.current = false; return }
    if (!autoTalk || !SR || autoTalkedRef.current) return
    autoTalkedRef.current = true
    startRecording()
  }, [open, autoTalk, startRecording])


  // Receipt photo (owner or crew), camera or library. The picked file is
  // shrunk and turned into a JPEG first (an iPhone HEIC included, see
  // utils/imageToJpeg), then it sits in the tray while the scan reads it in the
  // background. He can say or type which job while that runs; Send makes the
  // card. A photo this phone can't open gets a plain message, never silence.
  const onReceiptPick = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || busy || scanning) return
    setScanning(true)
    let img
    try {
      img = await toJpeg(file)
    } catch (err) {
      setScanning(false)
      pushMsg({ role: 'assistant', text: imageErrorMessage(err) })
      return
    }
    setScanning(false)
    let previewUrl = ''
    try { previewUrl = URL.createObjectURL(img.blob); urlsRef.current.push(previewUrl) } catch { /* no preview, still works */ }
    const scanP = scanReceiptImage(img.base64).catch(() => ({ error: 'scan failed' }))
    scanPromiseRef.current = scanP
    setAttach({ blob: img.blob, previewUrl, name: jpegName(file.name), scan: undefined })
    scanP.then((scan) => setAttach((a) => (a && a.blob === img.blob ? { ...a, scan } : a)))
  }, [busy, scanning])

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
    // Controlled: the parent's nav is the button, so don't stack a second one
    // on top of it.
    if (controlled) return null
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
      {/* As a destination it takes the whole screen — a sheet with the old
          dashboard peeking out above it still reads as "a helper on top of the
          real app," which is the opposite of the point. */}
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#F7F8FA', borderTopLeftRadius: controlled ? 0 : 18, borderTopRightRadius: controlled ? 0 : 18, height: controlled ? '100%' : '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                  {m.image && <img src={m.image} alt="Receipt photo" style={{ display: 'block', width: 160, maxWidth: '100%', borderRadius: 10, marginBottom: m.text ? 6 : 0 }} />}
                  {m.text}
                </div>
              ))}
              {/* Nothing said yet → show the whole menu of what it can do. */}
              {msgs.length <= 1 && !pending && !attach && (
                <Templates items={templates} disabled={busy || scanning} onPick={pickTemplate} />
              )}
              {pending && pending.kind === 'receipt' && (
                <ReceiptCard receipt={pending.receipt} busy={busy} onChange={updateReceipt} onConfirm={confirmAction} onCancel={cancelAction} />
              )}
              {pending && pending.kind !== 'receipt' && (
                <div style={{ alignSelf: 'flex-start', maxWidth: '92%', background: '#FFF4ED', border: `1px solid ${ORANGE}`, borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: ORANGE, marginBottom: 4, letterSpacing: 0.3 }}>
                    {pending.actions && pending.actions.length > 1 ? `ABOUT TO DO ${pending.actions.length} THINGS:` : 'ABOUT TO:'}
                  </div>
                  {/* A batch gets one line per action, not one run-on sentence.
                      This card is the last thing read before it saves, so what
                      is about to happen has to be countable at a glance. */}
                  {pending.actions && pending.actions.length > 1 ? (
                    <ol style={{ fontSize: 14, color: NAVY, margin: '0 0 10px', paddingLeft: 20, lineHeight: 1.45 }}>
                      {pending.actions.map((a, i) => <li key={i} style={{ marginBottom: 3 }}>{a.summary}</li>)}
                    </ol>
                  ) : (
                    <div style={{ fontSize: 14, color: NAVY, marginBottom: 10 }}>{pending.summary}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={confirmAction} disabled={busy} style={{ flex: 1, padding: '9px', border: 'none', borderRadius: 9, background: ORANGE, color: 'white', fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                    <button onClick={cancelAction} disabled={busy} style={{ flex: 1, padding: '9px', border: '1px solid #d1d5db', borderRadius: 9, background: 'white', color: NAVY, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              )}
              {(busy || scanning) && <div style={{ alignSelf: 'flex-start', color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>{scanning ? 'opening the photo…' : 'thinking…'}</div>}
            </div>
            {/* Mid-conversation the same list rides above the keyboard as a thin
                scrolling row. Hidden while a Confirm card is up — one decision
                on screen at a time. */}
            {msgs.length > 1 && !pending && !attach && (
              <div style={{ borderTop: '1px solid #e5e7eb' }}>
                <Templates items={templates} compact disabled={busy || scanning} onPick={pickTemplate} />
              </div>
            )}
            {/* THE COMPOSER IS THE RECORD BUTTON.
                A 44px 🎤 tucked between a receipt icon and a text box is a
                control you have to go looking for, and JP was looking for it
                while the sheet told him to hold something that wasn't on the
                screen. So the mic is now the widest, tallest thing down here —
                one tap arms it, one tap sends it, and it says both of those
                things in words on its own face. Typing still works underneath
                it for anyone who'd rather. */}
            <div style={{ padding: 12, paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', borderTop: msgs.length > 1 && !pending && !attach ? 'none' : '1px solid #e5e7eb', background: 'white' }}>
              {/* The receipt photo waiting to go. It says what the scan read,
                  and the one thing to do next. */}
              {attach && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, marginBottom: 10, border: '1px solid #e5e7eb', borderRadius: 12, background: '#F7F8FA' }}>
                  {attach.previewUrl
                    ? <img src={attach.previewUrl} alt="Receipt photo to send" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                    : <div style={{ width: 52, height: 52, borderRadius: 8, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🧾</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: NAVY, overflowWrap: 'anywhere' }}>
                      {attach.scan === undefined
                        ? 'Reading the receipt…'
                        : attach.scan && !attach.scan.error && (attach.scan.store || attach.scan.amount)
                          ? `${attach.scan.store || 'Receipt'}${attach.scan.amount ? ` · ${moneyStr(attach.scan.amount)} before tax` : ''}`
                          : "Couldn't read it. You can type the numbers next."}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Say or type which job it's for, then Send. Nothing saves until you Confirm.</div>
                  </div>
                  <button onClick={removeAttach} disabled={busy} aria-label="Remove the receipt photo" style={{ width: 44, height: 44, flexShrink: 0, border: '1px solid #d1d5db', borderRadius: 10, background: 'white', color: NAVY, fontSize: 20, cursor: 'pointer' }}>×</button>
                </div>
              )}
              {SR && (
                <button
                  onClick={toggleMic}
                  disabled={busy || scanning}
                  aria-label={listening ? 'Stop recording and send' : 'Tap and talk'}
                  style={{
                    width: '100%', minHeight: 62, padding: '10px 14px', marginBottom: 10,
                    border: 'none', borderRadius: 14,
                    background: listening ? '#DC2626' : NAVY, color: 'white',
                    cursor: 'pointer', opacity: busy || scanning ? 0.55 : 1,
                    boxShadow: listening ? '0 0 0 4px rgba(220,38,38,0.18)' : '0 2px 8px rgba(28,43,58,0.25)',
                    display: 'block', textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.2 }}>
                    {listening ? `⏹  Stop and send  ·  ${mmss(talkSecs)}` : '🎤  Tap and talk'}
                  </div>
                  {/* The subtitle is the whole instruction. While it's armed it
                      has to say that a pause is safe, because the old build
                      quit on the first one and that is what taught him to
                      feed it one fact at a time. */}
                  <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.85, marginTop: 3 }}>
                    {listening ? 'Keep going — take your time, pauses are fine' : 'Say the whole thing in one go'}
                  </div>
                </button>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {/* Receipt photo, owner and crew both. No `capture`, so the
                    phone offers the camera AND the photo library. */}
                <input ref={fileRef} type="file" accept="image/*" onChange={onReceiptPick} style={{ display: 'none' }} data-testid="receipt-file" />
                <button onClick={() => { if (fileRef.current) fileRef.current.click() }} disabled={busy || scanning || listening} aria-label="Add a receipt photo" title="Add a receipt photo" style={{ width: 48, minHeight: 48, border: '1px solid #d1d5db', borderRadius: 10, background: 'white', fontSize: 20, cursor: 'pointer' }}>🧾</button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !listening) send() }}
                  readOnly={listening}
                  placeholder={listening ? 'Listening…' : attach ? 'Which job? (optional)' : isOwner ? 'Or type it…' : 'Clock in, check hours, time off…'}
                  style={{ flex: 1, minWidth: 0, padding: '11px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 15, outline: 'none', background: listening ? '#F3F4F6' : 'white' }}
                />
                {/* Send is off while the mic is armed. There is exactly one way
                    to finish a spoken pile and it is the big red button — two
                    ways to send is how half a sentence goes out. */}
                <button onClick={send} disabled={busy || listening || (!input.trim() && !attach)} style={{ padding: '0 16px', minHeight: 48, border: 'none', borderRadius: 10, background: (input.trim() || attach) && !busy && !listening ? ORANGE : '#d1d5db', color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Send</button>
              </div>
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
