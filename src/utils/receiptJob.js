// Which job does a receipt photo belong on?
//
// The assistant's receipt card always shows a job picker. This only decides
// what that picker starts on. The rule is: preselect a job only when it is
// clear, and when it is not, leave the picker empty so the owner has to choose.
// A receipt booked to the wrong job is a wrong profit number all season, so
// "clear" is deliberately strict:
//
//   1. He opened the assistant from inside a job      -> that job.
//   2. His note names one job ("for the Smith deck")   -> that job.
//   3. He has exactly one live job                     -> that job.
//   Anything else                                      -> no guess.
//
// A port of the word matching in api/assistant.js (a Vercel function and the
// React bundle can't import each other), tuned for a short spoken note.

const STOP = new Set([
  'the', 'a', 'an', 'my', 'our', 'job', 'jobs', 'project', 'site', 'at', 'on', 'for', 'of', 'and',
  'this', 'that', 'is', 'it', 'its', 'was', 'receipt', 'receipts', 'from', 'to', 'in', 'put', 'add',
  'with', 'here', 'heres', 'please', 'goes', 'go', 'belongs', 'bill', 'charge', 'me', 'we', 'us',
  'just', 'got', 'bought', 'today', 'yesterday', 'over', 'up', 'one', 'stuff', 'some',
])

// Words half a job list shares. One of these on its own is not enough to pick
// a job ("the deck" when there are three decks, or one deck that isn't his).
const GENERIC = new Set([
  'deck', 'kitchen', 'bath', 'bathroom', 'roof', 'roofing', 'basement', 'remodel', 'reno', 'renovation',
  'addition', 'siding', 'window', 'windows', 'floor', 'floors', 'flooring', 'paint', 'painting', 'garage',
  'porch', 'fence', 'patio', 'house', 'home', 'residence', 'repair', 'repairs', 'new', 'old', 'main',
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'drive', 'dr', 'lane', 'ln', 'phase', 'install', 'replacement',
])

const tokenize = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w))
const wordHit = (a, b) => a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b))

// The one job a short note names, or null.
export function matchJobFromNote(note, jobs) {
  const said = tokenize(note)
  if (!said.length || !Array.isArray(jobs) || !jobs.length) return null
  const scored = jobs
    .map((j) => {
      const have = tokenize(j && j.name)
      const hits = have.filter((h) => said.some((w) => wordHit(w, h)))
      return { j, have, hits }
    })
    .filter((s) => s.hits.length > 0)
  if (!scored.length) return null
  const best = Math.max(...scored.map((s) => s.hits.length))
  const top = scored.filter((s) => s.hits.length === best)
  if (top.length !== 1) return null
  const t = top[0]
  // Two words of the name, or the whole of a one-word name.
  if (best >= Math.min(2, t.have.length)) return t.j
  // One word of a longer name only counts when it's distinctive (a surname, a
  // street name), never a trade word like "deck".
  if (t.hits.some((h) => !GENERIC.has(h))) return t.j
  return null
}

const isLive = (j) => j && j.stage !== 'end' && !j.is_sample

// -> { id, why: 'open' | 'said' | 'only' } or null
export function pickReceiptJob({ jobs, note, projectId }) {
  const list = Array.isArray(jobs) ? jobs : []
  if (projectId) {
    const open = list.find((j) => j.id === projectId)
    if (open) return { id: open.id, why: 'open' }
  }
  const said = matchJobFromNote(note, list)
  if (said) return { id: said.id, why: 'said' }
  const live = list.filter(isLive)
  if (live.length === 1) return { id: live[0].id, why: 'only' }
  return null
}

// Live jobs first, newest first within each group; the tutorial job never.
export function orderJobsForPicker(jobs) {
  const list = (Array.isArray(jobs) ? jobs : []).filter((j) => j && j.id && !j.is_sample)
  return [...list.filter((j) => j.stage !== 'end'), ...list.filter((j) => j.stage === 'end')]
}

// A spoken "gas receipt" should not land in the materials budget. Only the
// obvious words; everything else stays materials and the card shows it.
const CATEGORY_WORDS = [
  ['fuel', ['gas', 'fuel', 'diesel', 'gasoline']],
  ['meals', ['lunch', 'dinner', 'breakfast', 'food', 'meal', 'meals', 'coffee']],
  ['tools', ['tool', 'tools']],
  ['permits', ['permit', 'permits']],
  ['subcontractor', ['subcontractor', 'sub']],
  ['supplies', ['supplies']],
]
export function guessCategory(note) {
  const words = String(note || '').toLowerCase().split(/[^a-z0-9]+/)
  for (const [cat, list] of CATEGORY_WORDS) {
    if (words.some((w) => list.includes(w))) return cat
  }
  return 'materials'
}
