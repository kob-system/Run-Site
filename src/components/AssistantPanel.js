import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// In-app AI assistant (owner MVP). A floating ✨ button opens a bottom sheet.
// Type a question or an action; reads answer inline, writes show a confirm card
// before anything saves. Every executed action is audited (Activity tab).
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const tok = data && data.session && data.session.access_token
  return tok ? { Authorization: `Bearer ${tok}` } : {}
}

export default function AssistantPanel({ onDataChanged }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('chat')
  const [msgs, setMsgs] = useState([
    { role: 'assistant', text: "Hey — I can look up job profit, what you're owed, worker hours, and add expenses or create jobs for you. What do you need?" },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null) // { tool, args, summary }
  const [activity, setActivity] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, pending, busy])

  const pushMsg = (m) => setMsgs((prev) => [...prev, m])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
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
        body: JSON.stringify({ message: text, history }),
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
        body: JSON.stringify({ tool: p.tool, args: p.args }),
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

  const loadActivity = useCallback(async () => {
    const { data, error } = await supabase
      .from('assistant_actions')
      .select('action, params, status, result, created_at, actor_role')
      .order('created_at', { ascending: false })
      .limit(25)
    setActivity(error ? [] : (data || []))
  }, [])

  useEffect(() => { if (open && tab === 'activity' && activity === null) loadActivity() }, [open, tab, activity, loadActivity])

  const describe = (a) => {
    const p = a.params || {}
    if (a.action === 'add_expense') return `Added $${Number(p.amount || 0).toFixed(2)} ${p.category || 'materials'} to “${p.job_name || '—'}”`
    if (a.action === 'create_job') return `Created job “${p.name || '—'}”`
    return a.action
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
              {busy && <div style={{ alignSelf: 'flex-start', color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>thinking…</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e5e7eb', background: 'white' }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send() }}
                placeholder="Ask or tell me to do something…"
                style={{ flex: 1, padding: '11px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 15, outline: 'none' }}
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
