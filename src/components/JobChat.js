import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// One thread per job, shared by the owner and everyone assigned to it.
// Rendered on BOTH sides of the app from this one file, because the day the
// owner's chat and the crew's chat are two components is the day they drift and
// somebody's message renders on one screen and not the other.
//
// Backed by FIX-DATABASE-33. Until that migration is run the view does not
// exist, Postgres answers 42P01, and this shows a plain "not turned on yet"
// note instead of an error nobody on a jobsite can act on.
//
// No websockets: a 15-second poll while the tab is open, plus an immediate
// refetch when the phone comes back to the foreground. On a jobsite the app
// spends most of its life backgrounded, and a socket that reconnects on every
// wake costs more than it returns.

const READ_KEY = (projectId) => `jobtally_chat_read_${projectId}`
const POLL_MS = 15000

export function markChatRead(projectId, iso) {
  try { localStorage.setItem(READ_KEY(projectId), iso || new Date().toISOString()) } catch { /* private mode */ }
}

export function lastChatRead(projectId) {
  try { return localStorage.getItem(READ_KEY(projectId)) } catch { return null }
}

export function formatChatTime(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`
}

export default function JobChat({ projectId, selfId, placeholder = 'Message the crew…', height = '46vh' }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notInstalled, setNotInstalled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const scrollRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const { data, error: e } = await supabase
        .from('job_message_feed')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
        .limit(200)
      if (e) throw e
      if (!mountedRef.current) return
      setMessages(data || [])
      setNotInstalled(false)
      setError('')
      setLoaded(true)
      if (data && data.length) markChatRead(projectId, data[data.length - 1].created_at)
      else markChatRead(projectId)
    } catch (e) {
      if (!mountedRef.current) return
      // 42P01 = the migration hasn't been run. Say that plainly instead of
      // showing a red error to a framer who can do nothing about it.
      if (e && e.code === '42P01') { setNotInstalled(true); setLoaded(true); return }
      setError("Couldn't load messages. Check your signal.")
      setLoaded(true)
    }
  }, [projectId])

  useEffect(() => { setLoaded(false); setMessages([]); load() }, [load])

  // Poll while visible; refetch the moment the phone wakes up.
  useEffect(() => {
    if (notInstalled) return
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load, notInstalled])

  // Pin to the newest message, the way every phone thread behaves.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  const send = async (e) => {
    if (e) e.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      const { data, error: e2 } = await supabase.rpc('post_job_message', { p_project_id: projectId, p_body: body })
      if (e2) throw e2
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        setMessages(prev => [...prev, row])
        markChatRead(projectId, row.created_at)
      }
      setDraft('')
    } catch (err) {
      if (err && err.code === 'PGRST202') setNotInstalled(true)
      else setError("Message didn't send. Try again when you have bars.")
    } finally {
      setSending(false)
    }
  }

  if (notInstalled) {
    return (
      <div className="empty-state">
        <p style={{ fontWeight: 700, color: '#1C2B3A', marginBottom: '4px' }}>Crew chat isn’t switched on yet</p>
        <p>Nothing is broken — this job’s thread turns on the moment the chat update is applied to the database.</p>
      </div>
    )
  }

  return (
    <div>
      <div
        ref={scrollRef}
        style={{ height, overflowY: 'auto', background: '#F4F6F9', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '12px', marginBottom: '10px' }}
      >
        {!loaded && <p style={{ fontSize: '13px', color: '#9CA3AF', textAlign: 'center', margin: '20px 0' }}>Loading…</p>}
        {loaded && messages.length === 0 && (
          <div style={{ textAlign: 'center', margin: '18px 8px', color: '#6B7280' }}>
            <p style={{ fontWeight: 700, color: '#1C2B3A', marginBottom: '4px' }}>No messages on this job yet</p>
            <p style={{ fontSize: '13px', lineHeight: 1.5 }}>Everyone on this job sees this thread — and it stays with the job, so nothing gets lost in a group text.</p>
          </div>
        )}
        {messages.map(m => {
          // A diary line the app wrote because something happened on the job
          // (FIX-DATABASE-35). It is nobody's message: centred, grey, no
          // bubble, no name. It must never look like a person said it — that
          // is the entire reason `kind` exists instead of posting as the owner.
          //
          // The `=== 'system'` test is deliberate rather than `!== 'human'`:
          // on a database where 35 has not run, `kind` is undefined and every
          // row falls through to the normal bubble, which is exactly right.
          if (m.kind === 'system') {
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
                <div style={{ maxWidth: '88%', textAlign: 'center' }}>
                  <p style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.45, background: 'rgba(0,0,0,0.035)', borderRadius: '10px', padding: '6px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</p>
                  <p style={{ fontSize: '10px', color: '#9CA3AF', margin: '3px 0 0' }}>{formatChatTime(m.created_at)}</p>
                </div>
              </div>
            )
          }
          const mine = m.author_id === selfId
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: '10px' }}>
              <div style={{ maxWidth: '82%' }}>
                {!mine && (
                  <p style={{ fontSize: '11px', fontWeight: '700', color: m.author_is_owner ? '#E07B2A' : '#6B7280', margin: '0 0 3px 4px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {m.author_name}{m.author_is_owner ? ' · boss' : ''}
                  </p>
                )}
                <div style={{
                  background: mine ? '#1C2B3A' : 'white',
                  color: mine ? 'white' : '#1C2B3A',
                  border: mine ? 'none' : '1px solid #E5E7EB',
                  borderRadius: '14px',
                  padding: '10px 13px',
                  fontSize: '15px',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>{m.body}</div>
                <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '3px 4px 0', textAlign: mine ? 'right' : 'left' }}>{formatChatTime(m.created_at)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p style={{ fontSize: '13px', color: '#B45309', margin: '0 0 8px' }}>{error}</p>}

      <form onSubmit={send} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={placeholder}
          rows={1}
          maxLength={2000}
          style={{ flex: 1, resize: 'none', minHeight: '48px', maxHeight: '120px', padding: '13px 14px', border: '1px solid #E5E7EB', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          style={{ flex: '0 0 auto', minHeight: '48px', padding: '0 20px', borderRadius: '10px', border: 'none', background: (!draft.trim() || sending) ? '#C7CDD4' : '#E07B2A', color: 'white', fontWeight: '700', fontSize: '15px', cursor: (!draft.trim() || sending) ? 'default' : 'pointer' }}
        >{sending ? '…' : 'Send'}</button>
      </form>
    </div>
  )
}
