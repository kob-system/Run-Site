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

// `open` + `onOpenChange` make this a CONTROLLED panel — the owner's bottom nav
// owns the ✨ button now, because talking to it is meant to read as a place you
// go, not a helper hovering over the screen you're already on. Left uncontrolled
// (the crew side) it keeps its own floating button and behaves exactly as before.
export default function AssistantPanel({ onDataChanged, role = 'owner', open: openProp, onOpenChange, autoTalk = false, projectId = null }) {
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

  const send = useCallback(async (overrideText, keepVoice) => {
    const text = (typeof overrideText === 'string' ? overrideText : input).trim()
    if (!text || busy) return
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
    if (projectId && (keepVoice || voiceTurnRef.current)) {
      supabase.rpc('post_job_message', { p_project_id: projectId, p_body: text })
        .then(() => {}, () => {})
    }
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
  }, [input, busy, msgs, say, hush, projectId])

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
  }, [pending, busy, activity, onDataChanged, say])

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
                  {m.text}
                </div>
              ))}
              {/* Nothing said yet → show the whole menu of what it can do. */}
              {msgs.length <= 1 && !pending && (
                <Templates items={templates} disabled={busy || scanning} onPick={pickTemplate} />
              )}
              {pending && (
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
            {/* THE COMPOSER IS THE RECORD BUTTON.
                A 44px 🎤 tucked between a receipt icon and a text box is a
                control you have to go looking for, and JP was looking for it
                while the sheet told him to hold something that wasn't on the
                screen. So the mic is now the widest, tallest thing down here —
                one tap arms it, one tap sends it, and it says both of those
                things in words on its own face. Typing still works underneath
                it for anyone who'd rather. */}
            <div style={{ padding: 12, paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', borderTop: msgs.length > 1 && !pending ? 'none' : '1px solid #e5e7eb', background: 'white' }}>
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
                {/* Receipt scan — owner and crew both; a crew scan books to the boss server-side. */}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onReceiptPick} style={{ display: 'none' }} />
                <button onClick={() => { if (fileRef.current) fileRef.current.click() }} disabled={busy || scanning || listening} aria-label="Scan a receipt" title="Scan a receipt" style={{ width: 44, border: '1px solid #d1d5db', borderRadius: 10, background: 'white', fontSize: 18, cursor: 'pointer' }}>🧾</button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !listening) send() }}
                  readOnly={listening}
                  placeholder={listening ? 'Listening…' : isOwner ? 'Or type it…' : 'Clock in, check hours, time off…'}
                  style={{ flex: 1, minWidth: 0, padding: '11px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 15, outline: 'none', background: listening ? '#F3F4F6' : 'white' }}
                />
                {/* Send is off while the mic is armed. There is exactly one way
                    to finish a spoken pile and it is the big red button — two
                    ways to send is how half a sentence goes out. */}
                <button onClick={send} disabled={busy || listening || !input.trim()} style={{ padding: '0 16px', border: 'none', borderRadius: 10, background: input.trim() && !busy && !listening ? ORANGE : '#d1d5db', color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Send</button>
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
