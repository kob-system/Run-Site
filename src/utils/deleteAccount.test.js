// api/delete-account.js: billing must stop BEFORE anything is deleted, and a
// Stripe refusal must leave the account untouched. fetch is faked per URL so
// every Supabase and Stripe call is visible and in order.

jest.mock('../../api/_alert', () => ({ alertOwner: jest.fn(() => Promise.resolve(true)) }))

const SB = 'https://sb.test'
const UID = '11111111-1111-4111-8111-111111111111'
const EMAIL = 'owner@example.com'

let calls
let routes

function reply(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body || '')),
  })
}

// First route whose [method, url-prefix] matches wins.
function fakeFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  calls.push(`${method} ${url}`)
  for (const [m, prefix, fn] of routes) {
    if (m === method && url.startsWith(prefix)) return fn(url, opts)
  }
  return reply(200, [])
}

function baseRoutes({ subRow = null, subReadStatus = 200 } = {}) {
  return [
    ['GET', `${SB}/auth/v1/user`, () => reply(200, { id: UID, email: EMAIL })],
    ['POST', `${SB}/rest/v1/rpc/rate_limit_hit`, () => reply(200, true)],
    ['GET', `${SB}/rest/v1/subscriptions`, () => reply(subReadStatus, subReadStatus === 200 ? (subRow ? [subRow] : []) : { message: 'boom' })],
    ['GET', `${SB}/rest/v1/profiles`, () => reply(200, [{ role: 'owner', owner_id: null, company_name: 'Acme' }])],
    ['POST', `${SB}/storage/v1/object/list/receipts`, () => reply(200, [])],
    ['GET', `${SB}/rest/v1/projects`, () => reply(200, [])],
    ['DELETE', `${SB}/rest/v1/`, () => reply(204, null)],
    ['PATCH', `${SB}/rest/v1/`, () => reply(204, null)],
    ['DELETE', `${SB}/auth/v1/admin/users/`, () => reply(200, {})],
  ]
}

function load({ stripe = true } = {}) {
  jest.resetModules()
  process.env.REACT_APP_SUPABASE_URL = SB
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  if (stripe) process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  else delete process.env.STRIPE_SECRET_KEY
  return require('../../api/delete-account').default
}

function run(handler) {
  const res = {}
  res.statusCode = 200
  res.status = jest.fn((c) => { res.statusCode = c; return res })
  res.json = jest.fn((b) => { res.body = b; return res })
  res.end = jest.fn(() => res)
  const req = { method: 'POST', headers: { authorization: 'Bearer user-jwt' }, body: { confirmEmail: EMAIL } }
  return handler(req, res).then(() => res)
}

const deletesOf = () => calls.filter((c) => c.startsWith('DELETE') && c.includes(SB))
const stripeCalls = () => calls.filter((c) => c.includes('api.stripe.com'))

beforeEach(() => {
  calls = []
  global.fetch = jest.fn(fakeFetch)
})

test('an owner with a live subscription: Stripe cancel runs before the first delete', async () => {
  routes = [
    ['GET', 'https://api.stripe.com/v1/subscriptions?customer=cus_1', () =>
      reply(200, { data: [{ id: 'sub_1', status: 'active' }] })],
    ['DELETE', 'https://api.stripe.com/v1/subscriptions/sub_1', () => reply(200, { id: 'sub_1', status: 'canceled' })],
    ...baseRoutes({ subRow: { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active' } }),
  ]
  const res = await run(load())
  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual({ ok: true })
  const cancelAt = calls.indexOf('DELETE https://api.stripe.com/v1/subscriptions/sub_1')
  const firstDelete = calls.findIndex((c) => c.startsWith('DELETE') && c.includes(SB))
  expect(cancelAt).toBeGreaterThan(-1)
  expect(firstDelete).toBeGreaterThan(cancelAt)
  expect(calls).toContain(`DELETE ${SB}/auth/v1/admin/users/${UID}`)
})

test('Stripe refuses and the sub is still live: 502 and NOTHING is deleted', async () => {
  routes = [
    ['GET', 'https://api.stripe.com/v1/subscriptions?customer=cus_1', () =>
      reply(200, { data: [{ id: 'sub_1', status: 'active' }] })],
    ['DELETE', 'https://api.stripe.com/v1/subscriptions/sub_1', () => reply(500, { error: { message: 'down' } })],
    ['GET', 'https://api.stripe.com/v1/subscriptions/sub_1', () => reply(200, { id: 'sub_1', status: 'active' })],
    ...baseRoutes({ subRow: { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active' } }),
  ]
  const res = await run(load())
  expect(res.statusCode).toBe(502)
  expect(res.body.error).toMatch(/nothing was deleted/i)
  expect(deletesOf()).toEqual([])
  const { alertOwner } = require('../../api/_alert')
  expect(alertOwner).toHaveBeenCalledWith('delete-account', expect.stringMatching(/could not cancel billing/i), expect.any(Object))
})

test('cancel refused because Stripe already canceled it: carries on and deletes', async () => {
  routes = [
    ['GET', 'https://api.stripe.com/v1/subscriptions?customer=cus_1', () => reply(200, { data: [] })],
    ['DELETE', 'https://api.stripe.com/v1/subscriptions/sub_1', () =>
      reply(400, { error: { code: 'subscription_canceled', message: 'already canceled' } })],
    ['GET', 'https://api.stripe.com/v1/subscriptions/sub_1', () => reply(200, { id: 'sub_1', status: 'canceled' })],
    ...baseRoutes({ subRow: { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active' } }),
  ]
  const res = await run(load())
  expect(res.statusCode).toBe(200)
  expect(calls).toContain(`DELETE ${SB}/auth/v1/admin/users/${UID}`)
})

test('a second live sub on the customer that our row never recorded is canceled too', async () => {
  routes = [
    ['GET', 'https://api.stripe.com/v1/subscriptions?customer=cus_1', () =>
      reply(200, { data: [{ id: 'sub_1', status: 'active' }, { id: 'sub_2', status: 'past_due' }, { id: 'sub_0', status: 'canceled' }] })],
    ['DELETE', 'https://api.stripe.com/v1/subscriptions/', () => reply(200, { status: 'canceled' })],
    ...baseRoutes({ subRow: { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active' } }),
  ]
  const res = await run(load())
  expect(res.statusCode).toBe(200)
  const cancels = stripeCalls().filter((c) => c.startsWith('DELETE'))
  expect(cancels.sort()).toEqual([
    'DELETE https://api.stripe.com/v1/subscriptions/sub_1',
    'DELETE https://api.stripe.com/v1/subscriptions/sub_2',
  ])
})

test('the subscriptions read fails: fail closed, 502, nothing deleted', async () => {
  routes = baseRoutes({ subReadStatus: 500 })
  const res = await run(load())
  expect(res.statusCode).toBe(502)
  expect(deletesOf()).toEqual([])
  expect(stripeCalls()).toEqual([])
})

test('a live sub on record but no Stripe key configured: refuse, nothing deleted', async () => {
  routes = baseRoutes({ subRow: { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active' } })
  const res = await run(load({ stripe: false }))
  expect(res.statusCode).toBe(502)
  expect(deletesOf()).toEqual([])
})

test('a comp account (no Stripe ids) never calls Stripe and deletes normally', async () => {
  routes = baseRoutes({ subRow: { stripe_subscription_id: null, stripe_customer_id: null, status: 'comp' } })
  const res = await run(load())
  expect(res.statusCode).toBe(200)
  expect(stripeCalls()).toEqual([])
  expect(calls).toContain(`DELETE ${SB}/auth/v1/admin/users/${UID}`)
})

test('the wrong confirmation email touches neither Stripe nor the database', async () => {
  routes = baseRoutes({ subRow: { stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', status: 'active' } })
  const handler = load()
  const res = {}
  res.status = jest.fn((c) => { res.statusCode = c; return res })
  res.json = jest.fn((b) => { res.body = b; return res })
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { confirmEmail: 'nope@example.com' } }, res)
  expect(res.statusCode).toBe(400)
  expect(stripeCalls()).toEqual([])
  expect(deletesOf()).toEqual([])
})
