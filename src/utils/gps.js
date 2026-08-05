// Location capture for the crew's punch clock.
//
// One rule governs this file: GPS NEVER BLOCKS A PUNCH. A blocked permission,
// a dead fix in a basement, an 8-second timeout in a steel building — all of
// them return nulls plus a plain-English reason, and the caller saves the
// shift anyway. A man's hours are not held hostage to a map pin.
//
// Used at BOTH ends of a shift: clock-in stamps where the job started,
// clock-out stamps where it ended.

// A phone that can't get a fix in 8 seconds isn't going to. Waiting longer
// just leaves a guy standing in the rain staring at a spinner.
export const GPS_TIMEOUT_MS = 8000

/**
 * @param {'in'|'out'} phase — which end of the shift; only changes the wording
 *        so the fix-it instructions name the button he's actually looking at.
 * @param {object} [geo] — injectable navigator.geolocation, for tests.
 * @returns {Promise<{lat: number|null, lng: number|null, issue: string}>}
 *          Always resolves. Never rejects.
 */
export async function captureGps(phase, geo) {
  const geolocation = geo !== undefined
    ? geo
    : (typeof navigator !== 'undefined' ? navigator.geolocation : null)

  try {
    if (!geolocation) throw { code: 0 }
    const pos = await new Promise((resolve, reject) =>
      geolocation.getCurrentPosition(resolve, reject, { timeout: GPS_TIMEOUT_MS })
    )
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, issue: '' }
  } catch (e) {
    // Never swallow the reason. A silent failure here hid a site-wide GPS
    // outage for a week.
    return { lat: null, lng: null, issue: gpsIssueMessage(e && e.code, phase) }
  }
}

// Split out so the copy is testable without stubbing the browser, and so the
// two phases can't drift apart the next time someone edits one of them.
export function gpsIssueMessage(code, phase) {
  const saved = phase === 'in'
    ? 'Your hours are saved — only the start location is missing.'
    : 'Your shift is saved — only the end location is missing.'

  switch (code) {
    case 1: // PERMISSION_DENIED
      return phase === 'in'
        ? 'Location is blocked for this site. Tap the lock icon in your browser bar and allow Location, then clock out and back in.'
        : 'Location is blocked for this site. Tap the lock icon in your browser bar and allow Location so your next shift stamps both ends.'
    case 2: // POSITION_UNAVAILABLE
      return `Your phone couldn't get a fix (no signal or GPS off). ${saved}`
    case 3: // TIMEOUT
      return `Getting your location timed out. ${saved}`
    default:
      return `This browser can't share location. ${saved}`
  }
}
