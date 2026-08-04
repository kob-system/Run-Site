import { isRecoveryUrl, readRecoveryParams } from './recoveryUrl'

// jsdom's location can't be assigned, but history.pushState moves it fine.
const goTo = (url) => window.history.pushState({}, '', url)

afterEach(() => goTo('/'))

describe('isRecoveryUrl', () => {
  test('the app root is not a recovery landing', () => {
    goTo('/')
    expect(isRecoveryUrl()).toBe(false)
  })

  test('an ordinary signed-in URL is not a recovery landing', () => {
    goTo('/?billing=1')
    expect(isRecoveryUrl()).toBe(false)
  })

  test('the token_hash link our email template sends is recognised', () => {
    goTo('/reset-password?token_hash=abc123&type=recovery')
    expect(isRecoveryUrl()).toBe(true)
  })

  test('the older implicit link (#access_token) is still recognised', () => {
    goTo('/#access_token=xyz&refresh_token=r&type=recovery')
    expect(isRecoveryUrl()).toBe(true)
  })

  // The exact URL a dead Supabase link produces — copied verbatim from a real
  // failure. Note there is no type=recovery on it: Supabase drops that when it
  // bounces a link, so detection can't depend on it.
  test('an expired link lands on the reset screen, not the landing page', () => {
    goTo('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=')
    expect(isRecoveryUrl()).toBe(true)
  })

  test('/reset-password with no params still reaches the screen', () => {
    goTo('/reset-password')
    expect(isRecoveryUrl()).toBe(true)
  })

  test('a trailing slash does not break the path match', () => {
    goTo('/reset-password/')
    expect(isRecoveryUrl()).toBe(true)
  })
})

describe('readRecoveryParams', () => {
  test('pulls the token hash out of the query string', () => {
    goTo('/reset-password?token_hash=tok_abc&type=recovery')
    const p = readRecoveryParams()
    expect(p.tokenHash).toBe('tok_abc')
    expect(p.type).toBe('recovery')
    expect(p.errorCode).toBeNull()
  })

  test('pulls the failure code out of the fragment', () => {
    goTo('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    const p = readRecoveryParams()
    expect(p.errorCode).toBe('otp_expired')
    // URLSearchParams decodes '+' as a space, so this reads as a sentence.
    expect(p.errorDescription).toBe('Email link is invalid or has expired')
  })

  test('reports an implicit-flow session when the fragment carries a token', () => {
    goTo('/#access_token=xyz&type=recovery')
    expect(readRecoveryParams().hasImplicitSession).toBe(true)
  })

  test('reports no implicit session on a token_hash link', () => {
    goTo('/reset-password?token_hash=tok_abc&type=recovery')
    expect(readRecoveryParams().hasImplicitSession).toBe(false)
  })
})
