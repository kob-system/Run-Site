import { captureGps, gpsIssueMessage, GPS_TIMEOUT_MS } from './gps'

// A fake navigator.geolocation. `fix` resolves, `code` rejects with that
// PositionError code, and nothing here touches the real browser API.
const geoThatReturns = (lat, lng) => ({
  getCurrentPosition: (ok) => ok({ coords: { latitude: lat, longitude: lng } })
})
const geoThatFails = (code) => ({
  getCurrentPosition: (ok, fail) => fail({ code })
})

describe('captureGps', () => {
  test('returns the coordinates and no issue on a good fix', async () => {
    // Troy, NY — where the crews actually are.
    const r = await captureGps('out', geoThatReturns(42.7284, -73.6918))
    expect(r).toEqual({ lat: 42.7284, lng: -73.6918, issue: '' })
  })

  test('asks the phone with an 8s timeout so nobody stares at a spinner', async () => {
    const getCurrentPosition = jest.fn((ok) =>
      ok({ coords: { latitude: 1, longitude: 2 } })
    )
    await captureGps('in', { getCurrentPosition })
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ timeout: GPS_TIMEOUT_MS })
  })

  // THE CONTRACT: every failure path still returns nulls, never throws, so the
  // caller saves the shift regardless. If one of these ever rejects, a worker
  // in a basement stops getting paid.
  test.each([
    ['permission denied', 1],
    ['position unavailable', 2],
    ['timeout', 3],
    ['some unknown code', 99]
  ])('never throws on %s — returns nulls plus a reason', async (_label, code) => {
    for (const phase of ['in', 'out']) {
      const r = await captureGps(phase, geoThatFails(code))
      expect(r.lat).toBeNull()
      expect(r.lng).toBeNull()
      expect(r.issue).toBeTruthy()
    }
  })

  test('handles a browser with no geolocation at all', async () => {
    const r = await captureGps('out', null)
    expect(r.lat).toBeNull()
    expect(r.lng).toBeNull()
    expect(r.issue).toMatch(/can't share location/)
  })
})

describe('gpsIssueMessage', () => {
  test('a blocked permission tells him how to unblock it, both phases', () => {
    expect(gpsIssueMessage(1, 'in')).toMatch(/lock icon/)
    expect(gpsIssueMessage(1, 'out')).toMatch(/lock icon/)
  })

  // The whole point of the `phase` argument: a guy who just clocked OUT must
  // not be told "your hours are saved" about a shift he already finished.
  test('reassures about the right thing for each phase', () => {
    expect(gpsIssueMessage(2, 'in')).toMatch(/hours are saved/)
    expect(gpsIssueMessage(2, 'in')).toMatch(/start location/)
    expect(gpsIssueMessage(2, 'out')).toMatch(/shift is saved/)
    expect(gpsIssueMessage(2, 'out')).toMatch(/end location/)
  })

  test('no message ever implies the punch failed', () => {
    for (const code of [1, 2, 3, 99]) {
      for (const phase of ['in', 'out']) {
        expect(gpsIssueMessage(code, phase)).not.toMatch(/failed|error|try again/i)
      }
    }
  })
})
