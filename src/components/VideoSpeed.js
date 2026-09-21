import React, { useEffect, useState } from 'react'

// Playback speed for every video we show: the walkthrough popup and the intro
// and pitch videos on the public pages. JP, 2026-09-13: the videos run about
// three minutes and people want to fly through them, so 1.5x and 2x sit right
// under each one.
//
// ONE choice for all of them, saved on the phone. Somebody who picked 2x on the
// intro wants 2x on the walkthrough too, so every copy of the hook on a page
// follows the same setting the moment it changes.
export const SPEEDS = [1, 1.5, 2]
export const SPEED_KEY = 'jobtally_video_speed'

const listeners = new Set()

function readSaved() {
  try {
    const n = Number(localStorage.getItem(SPEED_KEY))
    return SPEEDS.includes(n) ? n : 1
  } catch {
    return 1
  }
}

// Returns the speed, a setter, and a callback ref for the <video>. A callback
// ref, not useRef, so a video that React remounts (the walkthrough swaps its
// video on every tab change) gets the speed the moment the new one exists.
export function useVideoSpeed() {
  const [speed, setLocal] = useState(readSaved)
  const [video, setVideo] = useState(null)

  useEffect(() => {
    listeners.add(setLocal)
    return () => { listeners.delete(setLocal) }
  }, [])

  useEffect(() => {
    if (!video) return
    // defaultPlaybackRate too, because loading a source resets playbackRate to
    // it. Applied again on load and on play so a browser that resets the rate
    // when a preload="none" file finally loads still lands on the chosen speed.
    // Captions follow currentTime, so they stay in sync at any rate.
    const apply = () => {
      video.defaultPlaybackRate = speed
      if (video.playbackRate !== speed) video.playbackRate = speed
    }
    apply()
    video.addEventListener('loadedmetadata', apply)
    video.addEventListener('play', apply)
    return () => {
      video.removeEventListener('loadedmetadata', apply)
      video.removeEventListener('play', apply)
    }
  }, [video, speed])

  const setSpeed = s => {
    try { localStorage.setItem(SPEED_KEY, String(s)) } catch { /* private mode: still works for this visit */ }
    listeners.forEach(l => l(s))
  }

  return { speed, setSpeed, videoRef: setVideo }
}

// The three buttons. `dark` is for the walkthrough's dark overlay; the default
// is for the white and tinted sections on the public pages.
export function SpeedPicker({ speed, onChange, dark = false }) {
  const idle = dark
    ? { background: '#1f2d3b', color: '#cfd6dd', border: '2px solid #1f2d3b' }
    : { background: '#fff', color: 'var(--text)', border: '2px solid var(--border)' }
  const on = { background: 'var(--orange)', color: '#fff', border: '2px solid var(--orange)' }
  return (
    <div role="group" aria-label="Playback speed"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '14px', fontWeight: 700, color: dark ? '#9aa7b4' : 'var(--text-secondary)' }}>Speed</span>
      {SPEEDS.map(s => (
        <button key={s} type="button" aria-pressed={speed === s} onClick={() => onChange(s)}
          style={{ minHeight: 'var(--tap, 44px)', minWidth: '60px', padding: '8px 14px', borderRadius: '10px', fontSize: '16px', fontWeight: 800, lineHeight: 1, cursor: 'pointer', ...(speed === s ? on : idle) }}>
          {s}x
        </button>
      ))}
    </div>
  )
}
