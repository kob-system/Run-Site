// THE MIC IS THE FEATURE. THIS FILE GUARDS IT.
//
// JP, 2026-08-31: "it says hold the star button to talk, but when I hit it, it
// disappears... I don't want it to have to ask for each one of the pieces of
// information bit by bit. I want it to ask for the whole pile."
//
// Two separate defects were behind that one sentence, and both of them are
// invisible to every other test in this repo:
//
//   1. The control he was told to use was NOT ON THE SCREEN. It lived in the
//      bottom nav, and the sheet paints over the bottom nav.
//   2. The recognizer ended its run on his first pause and sent the fragment.
//      Four facts in one breath became four round trips.
//
// So this file asserts the two things that actually matter to a man standing on
// a jobsite: the record button is IN the sheet with words on it, and a pause
// does not end the recording.

import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'

jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

// Every recognizer the component builds, in order. `start` is counted rather
// than faked out, because "did it open another run after the pause" is the
// whole question this file exists to answer.
let recognizers = []
class FakeSR {
  constructor() {
    this.starts = 0
    this.aborted = 0
    this.lang = ''
    this.interimResults = false
    recognizers.push(this)
  }
  start() { this.starts += 1 }
  // The real engine fires onend asynchronously; firing it inline is close
  // enough and keeps the test free of a second layer of timers.
  stop() { if (this.onend) this.onend() }
  abort() { this.aborted += 1 }
}

// SR is read at MODULE LOAD, so the stub has to be on window before the
// component is required. That is why this is a require and not an import.
let AssistantPanel
beforeAll(() => {
  window.SpeechRecognition = FakeSR
  AssistantPanel = require('./AssistantPanel').default
})

beforeEach(() => {
  recognizers = []
  // CRA sets resetMocks: true, which wipes a mockResolvedValue set inside the
  // jest.mock factory before every test. Re-arm them here or authHeader()
  // awaits undefined and every send dies in the catch as a connection error.
  const { supabase } = require('../supabaseClient')
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
  supabase.rpc.mockResolvedValue({ data: null, error: null })
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'ok' }) })
  jest.useFakeTimers()
})
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

const openPanel = () => render(<AssistantPanel open onOpenChange={() => {}} />)

describe('the record button is reachable and says what it does', () => {
  it('puts a Tap-and-talk button inside the sheet', () => {
    openPanel()
    expect(screen.getByRole('button', { name: /tap and talk/i })).toBeInTheDocument()
  })

  // The greeting used to name a button that the sheet itself covers. If that
  // copy ever comes back it sends him hunting for a control that is not there.
  it('never tells him to hold anything', () => {
    openPanel()
    expect(document.body.textContent).not.toMatch(/hold the/i)
  })

  it('flips to Stop and send once it is armed', () => {
    openPanel()
    act(() => { fireEvent.click(screen.getByRole('button', { name: /tap and talk/i })) })
    expect(screen.getByRole('button', { name: /stop recording and send/i })).toBeInTheDocument()
    expect(recognizers[0].starts).toBe(1)
  })
})

describe('a pause does not end the recording', () => {
  it('opens another run instead of sending the first fragment', () => {
    openPanel()
    act(() => { fireEvent.click(screen.getByRole('button', { name: /tap and talk/i })) })
    const rec = recognizers[0]

    // He says the first thing, then stops to think. The engine ends its run.
    act(() => {
      rec.onresult({ results: [{ 0: { transcript: 'Dave and Tony six hours on Maple' }, isFinal: true }] })
      rec.onend()
    })

    // Nothing may go out yet — the pile is not finished.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /stop recording and send/i })).toBeInTheDocument()

    // And the mic must come back on by itself.
    act(() => { jest.advanceTimersByTime(300) })
    expect(rec.starts).toBe(2)
  })

  it('sends everything as ONE message when he taps stop', async () => {
    openPanel()
    act(() => { fireEvent.click(screen.getByRole('button', { name: /tap and talk/i })) })
    const rec = recognizers[0]

    act(() => {
      rec.onresult({ results: [{ 0: { transcript: 'Dave and Tony six hours on Maple' }, isFinal: true }] })
      rec.onend()
      jest.advanceTimersByTime(300)
      rec.onresult({ results: [{ 0: { transcript: 'and ninety bucks at Home Depot' }, isFinal: true }] })
    })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop recording and send/i })) })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.message).toMatch(/Dave and Tony six hours on Maple/)
    expect(body.message).toMatch(/ninety bucks at Home Depot/)
  })

  // A pause reads as a 'no-speech' error. While he is still recording that is
  // him thinking, and shouting an error at him for thinking is how the mic
  // stopped being trusted in the first place.
  it('stays quiet when a pause reports no-speech', () => {
    openPanel()
    act(() => { fireEvent.click(screen.getByRole('button', { name: /tap and talk/i })) })
    act(() => { recognizers[0].onerror({ error: 'no-speech' }) })
    expect(document.body.textContent).not.toMatch(/didn't catch/i)
    expect(screen.getByRole('button', { name: /stop recording and send/i })).toBeInTheDocument()
  })
})
