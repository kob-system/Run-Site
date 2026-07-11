import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// In-app AI assistant. A floating ✨ button opens a bottom sheet.
// Type a question or an action; reads answer inline, writes show a confirm card
// before anything saves. Every executed action is audited (Activity tab).
// v0.4: role="worker" mounts the crew persona (clock in/out, hours, schedule,
// time off — the API enforces the toolset server-side, this only sets copy),
// mic dictation where the browser supports SpeechRecognition, and owner-only
// receipt photo → /api/scan-receipt → normal add_expense confirm flow.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

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
      text: isOwner
        ? "Hey — I can do just about anything here for you: check profit and what you're owed, add expenses, hours, or mileage, create jobs, invoices, and estimates, manage the crew and schedule, permits, punch lists… just say it. I'll always show you a Confirm card before anything saves."
        : "Hey — I can clock you in or out, check your hours and pay, show your schedule and jobs, or send your boss a time-off request. Just say it (or tap the mic). I'll show you a Confirm card before anything saves.",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null) // { tool, args, summary }
  const [activity, setActivity] = useState(null)
  const [listening, setListening] = useState(false)
  const [scanning, setScanning] = useState(false)
  const scrollRef = useRef(null)
  const recogRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, pending, busy])

  const pushMsg = (m) => setMsgs((prev) => [...prev, m])

  const send = useCallback(async (overrideText) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!text || busy) return
    if (typeof overrideText !== 'string') setInput('')
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
      const data = await r.json()
      if (!r.ok) { pushMsg({ role: 'assistant', text: data.error || 'Something went wrong.' }); return }
      if (data.type === 'confirm') {
        setPending({ tool: data.tool, args: data.args, summary: data.summary })
      } else {
        pushMsg({ role: 'assistant', text: data.reply })
      }
    } catch {
      pushMsg({ role: 'assistant', text: "Couldn't reach the assistant. Check your connection." })
    } finally {
      setBusy(false)
    }
  }, [input, busy, msgs])

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
      const data = await r.json()
      pushMsg({ role: 'assistant', text: r.ok ? (data.message || 'Done ✓') : (data.error || "Couldn't do that.") })
      if (r.ok) {
        if (typeof onDataChanged === 'function') onDataChanged() // refresh dashboard money after a confirmed write
        if (activity) loadActivity()
      }
    } catch {
      pushMsg({ role: 'assistant', text: "Couldn't complete that action." })
    } finally {
      setBusy(false)
    }
  }, [pending, busy, activity, onDataChanged])

  // Mic dictation — browser speech-to-text into the input box. Button only
  // renders when the browser has SpeechRecognition (iOS Safari 14.5+, Chrome).
  const toggleMic = useCallback(() => {
    if (!SR) return
    if (listening) {
      try { if (recogRef.current) recogRef.current.stop() } catch { /* already stopped */ }
      setListening(false)
      return
    }
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const t = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : ''
      if (t) setInput((prev) => (prev ? prev + ' ' : '') + t)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recogRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch { setListening(false) }
  }, [listening])

  // Receipt photo (owner only): photo → /api/scan-receipt (Haiku vision) →
  // auto-send the store/amount so the normal add_expense confirm flow takes over.
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
      if (!resp.ok || (!store && !amount)) {
        pushMsg({ role: 'assistant', text: (data && data.error) || 'Couldn’t read that receipt — try a clearer photo, or just tell me the store and amount.' })
        return
      }
      setScanning(false)
      await send(`I scanned a receipt${store ? ` from ${store}` : ''}${amount ? ` for $${amount}` : ''} — add it as an expense. Ask me which job if you need to.`)
    } catch {
      pushMsg({ role: 'assistant', text: 'Couldn’t read that receipt. Tell me the store and amount instead.' })
    } finally {
      setScanning(false)
    }
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
          position: 'fixed', right: 16, bottom: 84, zIndex: 900,
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
          <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer' }}>×</button>
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
              {msgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.role === 'user' ? ORANGE : 'white', color: m.role === 'user' ? 'white' : NAVY, padding: '10px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  {m.text}
                </div>
              ))}
              {pending && (
                <div style={{ alignSelf: 'flex-start', maxWidth: '92%', background: '#FFF4ED', border: `1px solid ${ORANGE}`, borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: ORANGE, marginBottom: 4, letterSpacing: 0.3 }}>ABOUT TO:</div>
                  <div style={{ fontSize: 14, color: NAVY, marginBottom: 10 }}>{pending.summary}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={confirmAction} disabled={busy} style={{ flex: 1, padding: '9px', border: 'none', borderRadius: 9, background: ORANGE, color: 'white', fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                    <button onClick={() => setPending(null)} disabled={busy} style={{ flex: 1, padding: '9px', border: '1px solid #d1d5db', borderRadius: 9, background: 'white', color: NAVY, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              )}
              {(busy || scanning) && <div style={{ alignSelf: 'flex-start', color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>{scanning ? 'reading receipt…' : 'thinking…'}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e5e7eb', background: 'white' }}>
              {isOwner && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onReceiptPick} style={{ display: 'none' }} />
                  <button onClick={() => { if (fileRef.current) fileRef.current.click() }} disabled={busy || scanning} aria-label="Scan a receipt" title="Scan a receipt" style={{ width: 44, border: '1px solid #d1d5db', borderRadius: 10, background: 'white', fontSize: 18, cursor: 'pointer' }}>🧾</button>
                </>
              )}
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
