import React, { useEffect, useRef, useState } from 'react'

// The two narrated walkthroughs JP recorded 2026-09-12: the owner side (3 min) and the
// worker side (1 min). Portrait crops of the phone, captions from what he actually said.
// A new owner gets it once by itself (see OwnerDashboard); anyone can replay it from More.
// Files live in public/walkthrough/ because the CSP only allows same-origin media.
const SIDES = {
  owner: { src: '/walkthrough/owner.mp4', poster: '/walkthrough/owner.jpg', captions: '/walkthrough/owner.vtt', label: 'Your side', length: '3 min' },
  worker: { src: '/walkthrough/worker.mp4', poster: '/walkthrough/worker.jpg', captions: '/walkthrough/worker.vtt', label: "Your worker's side", length: '1 min' },
}

export const walkthroughSeenKey = id => `jobtally_walkthrough_seen_${id}`

export default function Walkthrough({ open, start = 'owner', onClose }) {
  const [side, setSide] = useState(start)
  const [ended, setEnded] = useState(false)
  const [caption, setCaption] = useState('')
  const [autoPlay, setAutoPlay] = useState(false)
  const trackRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setSide(start); setEnded(false); setCaption(''); setAutoPlay(false)
    if (closeRef.current) closeRef.current.focus()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, start, onClose])

  // The <track> stays on the video for screen readers and full screen, but its cues are
  // drawn UNDER the video, so a caption never covers the buttons on the phone it shows.
  useEffect(() => {
    const t = trackRef.current && trackRef.current.track
    if (!t) return
    t.mode = 'hidden'
    const onCue = () => { const c = t.activeCues && t.activeCues[0]; setCaption(c ? c.text : '') }
    t.addEventListener('cuechange', onCue)
    return () => t.removeEventListener('cuechange', onCue)
  }, [open, side])

  if (!open) return null
  const v = SIDES[side]
  const go = s => { setSide(s); setEnded(false); setCaption(''); setAutoPlay(true) }  // a tap, so autoplay is allowed

  const btn = { minHeight: 'var(--tap)', padding: '10px 16px', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }
  return (
    <div role="dialog" aria-modal="true" aria-label="JobTally walkthrough"
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(12,18,26,0.94)', overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '460px', padding: '12px 16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: '#fff' }}>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 800 }}>JobTally walkthrough</div>
            <div style={{ fontSize: '13px', color: '#9aa7b4' }}>{v.label} · {v.length}</div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close walkthrough"
            style={{ ...btn, background: 'none', border: 'none', color: '#cfd6dd', fontSize: '28px', lineHeight: 1, padding: '4px 10px', minWidth: 'var(--tap)' }}>×</button>
        </div>

        <div role="tablist" aria-label="Which side" style={{ display: 'flex', width: '100%', background: '#1f2d3b', borderRadius: '12px', padding: '4px' }}>
          {Object.entries(SIDES).map(([k, s]) => (
            <button key={k} role="tab" aria-selected={side === k} onClick={() => side !== k && go(k)}
              style={{ ...btn, flex: 1, border: 'none', background: side === k ? '#E07B2A' : 'transparent', color: side === k ? '#fff' : '#cfd6dd' }}>
              {s.label}
            </button>
          ))}
        </div>

        <video key={side} controls playsInline preload="metadata" autoPlay={autoPlay} poster={v.poster}
          onEnded={() => setEnded(true)} onPlay={() => setEnded(false)}
          style={{ display: 'block', height: 'min(60vh, 560px)', maxWidth: '100%', aspectRatio: '540 / 1040', background: '#000', borderRadius: '14px' }}>
          <source src={v.src} type="video/mp4" />
          <track ref={trackRef} kind="captions" srcLang="en" label="English" src={v.captions} default />
          Your browser can't play this video.
        </video>

        <div aria-hidden="true" style={{ minHeight: '44px', width: '100%', textAlign: 'center', fontSize: '16px', lineHeight: 1.35, fontWeight: 600 }}>{caption}</div>

        {ended && side === 'owner' && (
          <div style={{ width: '100%', background: '#fff', color: '#1C2B3A', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '10px' }}>Would you like to see what it looks like from your worker's side?</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => go('worker')} style={{ ...btn, flex: 1, border: 'none', background: '#E07B2A', color: '#fff' }}>Show me · 1 min</button>
              <button onClick={onClose} style={{ ...btn, flex: 1, background: '#fff', border: '2px solid #E07B2A', color: '#E07B2A' }}>I'm good</button>
            </div>
          </div>
        )}
        {ended && side === 'worker' && (
          <div style={{ width: '100%', background: '#fff', color: '#1C2B3A', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '10px' }}>That's what your crew sees.</div>
            <button onClick={onClose} style={{ ...btn, width: '100%', border: 'none', background: '#E07B2A', color: '#fff' }}>Start using JobTally</button>
          </div>
        )}
        {!ended && (
          <button onClick={onClose} style={{ ...btn, background: 'none', border: 'none', color: '#9aa7b4', textDecoration: 'underline' }}>
            Skip for now · it's under More any time
          </button>
        )}
      </div>
    </div>
  )
}
