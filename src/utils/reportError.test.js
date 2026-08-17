// The flood control in reportError is the part that must not regress.
//
// A React remount loop calls componentDidCatch on every frame. Without the
// in-memory dedupe that is thousands of POSTs a second from one broken tab,
// and — since each one is a real email on the far end — an inbox JP would
// have to abandon. These tests pin the two behaviours that prevent it.
//
// jest.resetModules() runs before every test because the dedupe Set is module
// state: without a fresh module per test, test two starts with test one's
// signatures already recorded and passes for the wrong reason.
// (Not jest.isolateModulesAsync — that does not exist in the Jest 27 that
// react-scripts 5 pins.)

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('reportError flood control', () => {
  let sent

  beforeEach(() => {
    jest.resetModules()
    sent = []
    // Force the fetch path: sendBeacon is the preferred transport but jsdom
    // has no implementation, and asserting on fetch bodies is what tells us
    // what would actually have been transmitted.
    delete global.navigator.sendBeacon
    global.fetch = jest.fn((url, opts) => {
      sent.push(JSON.parse(opts.body))
      return Promise.resolve({ ok: true })
    })
  })

  test('the same error reported a thousand times sends exactly one request', async () => {
    const { reportError } = require('./reportError')
    for (let i = 0; i < 1000; i++) {
      reportError('react-render', new Error('Cannot read properties of undefined'))
    }
    await flush()
    expect(sent).toHaveLength(1)
  })

  test('digits are normalised out, so one bug across many rows is one report', async () => {
    const { reportError } = require('./reportError')
    // Same defect, different row ids — must collapse to a single signature.
    reportError('save', new Error('job 4821 not found'))
    reportError('save', new Error('job 9137 not found'))
    reportError('save', new Error('job 55 not found'))
    await flush()
    expect(sent).toHaveLength(1)
  })

  test('genuinely different errors are each reported, up to the session cap', async () => {
    const { reportError } = require('./reportError')
    // 20 distinct failures in one session is already a catastrophe; the cap
    // exists so the 20th doesn't cost 20 emails. MAX_PER_SESSION is 8.
    for (let i = 0; i < 20; i++) {
      reportError('where-' + String.fromCharCode(97 + i), new Error('distinct failure ' + String.fromCharCode(97 + i)))
    }
    await flush()
    expect(sent).toHaveLength(8)
  })

  test('a report carries the page and build so it can be traced, and no PII', async () => {
    const { reportError, setErrorContext } = require('./reportError')
    setErrorContext('user-abc-123', 'owner')
    reportError('react-render', new Error('boom'))
    await flush()

    expect(sent).toHaveLength(1)
    const body = sent[0]
    expect(body.message).toBe('boom')
    expect(body.where).toBe('react-render')
    expect(body.userId).toBe('user-abc-123')
    expect(body.role).toBe('owner')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('build')
    // The alert inbox must never accumulate customer contact details.
    expect(JSON.stringify(body)).not.toMatch(/@/)
  })

  test('reporting never throws, even when everything around it is broken', async () => {
    const { reportError } = require('./reportError')
    global.fetch = jest.fn(() => { throw new Error('network is gone') })
    // A non-Error, a null, and a transport that throws synchronously. If any
    // of these escape, an ErrorBoundary turns into an infinite crash loop.
    expect(() => reportError('a', null)).not.toThrow()
    expect(() => reportError('b', 'just a string')).not.toThrow()
    expect(() => reportError('c', { nope: true })).not.toThrow()
  })

  test('sendBeacon is preferred when present, because a reload cancels fetch', async () => {
    const beacon = jest.fn(() => true)
    global.navigator.sendBeacon = beacon
    const { reportError } = require('./reportError')
    reportError('react-render', new Error('boom'))
    await flush()
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('a refusing sendBeacon falls back to fetch instead of losing the report', async () => {
    // sendBeacon returns false when the payload exceeds the browser's queue
    // limit. Silently dropping the report there would hide exactly the
    // biggest, most informative crashes.
    global.navigator.sendBeacon = jest.fn(() => false)
    const { reportError } = require('./reportError')
    reportError('react-render', new Error('boom'))
    await flush()
    expect(sent).toHaveLength(1)
  })
})
