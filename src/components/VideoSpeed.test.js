// The speed buttons under every video. JP, 2026-09-13: the videos run about
// three minutes and people want to fly through them at 1.5x or 2x.
//
// What a person actually meets: the button they tapped lights up, the video
// really plays at that rate, the walkthrough keeps it across both tabs, and
// the choice is still there next time they open a video.

import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import Walkthrough from './Walkthrough'
import { useVideoSpeed, SpeedPicker, SPEED_KEY } from './VideoSpeed'

beforeEach(() => localStorage.clear())

// eslint-disable-next-line testing-library/no-node-access
const videos = () => Array.from(document.querySelectorAll('video'))

test('the walkthrough plays at the tapped speed and keeps it on the other tab', () => {
  render(<Walkthrough open start="owner" onClose={() => {}} />)
  expect(videos()[0].playbackRate).toBe(1)
  expect(screen.getByRole('button', { name: '1x' })).toHaveAttribute('aria-pressed', 'true')

  fireEvent.click(screen.getByRole('button', { name: '2x' }))
  expect(videos()[0].playbackRate).toBe(2)
  expect(screen.getByRole('button', { name: '2x' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '1x' })).toHaveAttribute('aria-pressed', 'false')
  expect(localStorage.getItem(SPEED_KEY)).toBe('2')

  // The worker tab swaps in a brand new <video>. It has to come up at 2x too.
  fireEvent.click(screen.getByRole('tab', { name: /worker's side/i }))
  expect(videos()[0].getAttribute('poster')).toMatch(/worker/)
  expect(videos()[0].playbackRate).toBe(2)
  expect(screen.getByRole('button', { name: '2x' })).toHaveAttribute('aria-pressed', 'true')
})

function TwoVideos() {
  const a = useVideoSpeed()
  const b = useVideoSpeed()
  return (
    <>
      <video ref={a.videoRef} />
      <div data-testid="a"><SpeedPicker speed={a.speed} onChange={a.setSpeed} /></div>
      <video ref={b.videoRef} />
      <div data-testid="b"><SpeedPicker speed={b.speed} onChange={b.setSpeed} /></div>
    </>
  )
}

test('a saved speed is used next visit, and one choice drives every video on the page', () => {
  localStorage.setItem(SPEED_KEY, '1.5')
  render(<TwoVideos />)
  expect(videos().map(v => v.playbackRate)).toEqual([1.5, 1.5])

  // Tapping 2x under the first video moves the second one too.
  fireEvent.click(within(screen.getByTestId('a')).getByRole('button', { name: '2x' }))
  expect(videos().map(v => v.playbackRate)).toEqual([2, 2])
  expect(within(screen.getByTestId('b')).getByRole('button', { name: '2x' })).toHaveAttribute('aria-pressed', 'true')
})

test('a junk saved value falls back to normal speed', () => {
  localStorage.setItem(SPEED_KEY, '9')
  render(<TwoVideos />)
  expect(videos().map(v => v.playbackRate)).toEqual([1, 1])
})
