// "New job, Smith deck, twelve thousand" must ALWAYS become a create-job card.
//
// The bug: the model sometimes read that sentence as a lookup and answered
// "I don't see a job called Smith deck", which is true, because he is trying to
// make it. Prompt text alone did not stop it, so api/assistant.js runs this
// matcher on the raw message and, on a hit, forces the create_job tool.
//
// Deliberately narrow. It fires only when the message OPENS with the intent
// (after filler like "okay", "I want you to", "let's") AND carries something
// after it to name the job. It does not fire on:
//   - questions ("how is the new job doing", "any new jobs this week?")
//   - an existing job ("start the Smith job", "put Dave on the new job")
//   - the bare template opener ("I want to set up a new job. Say it all...")
//     which has no name yet, so the model should ask for one.

const FILLER = /^(?:(?:ok(?:ay)?|hey|so|alright|all\s+right|um+|uh+|yeah|yes|yep|and|please|jobtally)[\s,.!:;-]+)*/i

const WANT = new RegExp(
  '^(?:' +
    [
      "i\\s+want\\s+(?:you\\s+)?to",
      'i\\s+wanna',
      'i\\s+need\\s+(?:you\\s+)?to',
      "i['’]?d\\s+like\\s+(?:you\\s+)?to",
      "let['’]?s",
      'let\\s+me',
      'lemme',
      '(?:can|could|would)\\s+you(?:\\s+please)?',
      'go\\s+ahead\\s+and',
      'help\\s+me',
      'we\\s+need\\s+to',
      '(?:we\\s+|i\\s+)?(?:got|have)',
    ].join('|') +
  ')\\s+',
  'i'
)

const INTENT = new RegExp(
  '^(?:' +
    // new job / a new job / create a new job / start a brand new project
    '(?:(?:create|add|make|set\\s*up|start|begin|open|put\\s+in|enter)\\s+)?(?:(?:a|an|another)\\s+)?(?:brand\\s+)?new\\s+(?:job|project)' +
    '|' +
    // start a job / create job / add another job (never "the job": that one exists)
    '(?:create|add|make|set\\s*up|start|begin)\\s+(?:(?:a|an|another)\\s+)?(?:job|project)' +
  ")(?![\\w'’])",
  'i'
)

// Connectors between the intent and the name: "new job CALLED Maple roof".
const LEAD = /^(?:[\s,.:;!–—-]+|(?:called|named|titled|for|at|on|with|it['’]?s|is)\b)+/i

// -> null, or { rest } where rest is what follows the intent phrase.
export function parseNewJobIntent(text) {
  if (typeof text !== 'string') return null
  let t = text.trim()
  if (!t || t.endsWith('?')) return null
  t = t.replace(FILLER, '')
  t = t.replace(WANT, '')
  t = t.replace(/^please\s+/i, '')
  const m = t.match(INTENT)
  if (!m) return null
  const rest = t.slice(m[0].length).replace(LEAD, '').trim()
  // Nothing to name the job with, so let the model ask for it.
  if (!/[a-z0-9]/i.test(rest)) return null
  // The New job template chip sends "...set up a new job. Say it all in one
  // go...". That is an instruction, not a job name.
  if (/^say\s+it\s+all\b/i.test(rest)) return null
  return { rest }
}

export function isNewJobIntent(text) {
  return parseNewJobIntent(text) !== null
}
