// "New job, Smith deck, twelve thousand" used to come back as "I don't see a
// job called Smith deck". api/assistant.js now forces the create-job tool when
// this matcher fires, so these cases are the contract for when it fires.
import { isNewJobIntent, parseNewJobIntent } from '../../api/_newJobIntent'

describe('isNewJobIntent: fires on a new job with a name', () => {
  it.each([
    'new job smith deck twelve thousand',
    'New job, Smith deck, twelve thousand',
    'start a job for the Klein bathroom 8500',
    'Create a new job called Maple roof, 15000',
    'Okay, new job: Jones kitchen $15,000',
    'I want you to add a new job for the Delgado basement, 22 grand',
    "Let's start a new project, Oak Street porch, 9k",
    'new job. Smith deck, twelve thousand.',
    'Hey JobTally, new job Peterson fence 4200',
    'can you create a job for the Rivera siding 18000',
    'set up a new job Main St storefront',
    'we got a new job, Hudson deck, 11k',
  ])('%s', (text) => {
    expect(isNewJobIntent(text)).toBe(true)
  })
})

describe('isNewJobIntent: stays out of the way everywhere else', () => {
  it.each([
    'how is the new job doing',
    'what jobs do I have',
    'any new jobs this week?',
    'New job?',
    'new job',
    'start a new job',
    // The New job template chip. No name yet, so the model should ask.
    "I want to set up a new job. Say it all in one go if you want — I'll fill in everything you gave me and only ask if something's genuinely missing.",
    'add 2x4s to the buy list',
    'start the Smith job',
    'add a receipt to the new job',
    'put Dave on the new job Monday',
    "what's on the new job's buy list",
    'Dave and Tony six hours on Maple',
    'jobs',
    '',
  ])('%s', (text) => {
    expect(isNewJobIntent(text)).toBe(false)
  })

  it('ignores non-strings', () => {
    expect(isNewJobIntent(null)).toBe(false)
    expect(isNewJobIntent(undefined)).toBe(false)
    expect(isNewJobIntent(42)).toBe(false)
  })
})

describe('parseNewJobIntent', () => {
  it('hands back what follows the intent, without the connector words', () => {
    expect(parseNewJobIntent('start a job for the Klein bathroom 8500').rest).toBe('the Klein bathroom 8500')
    expect(parseNewJobIntent('New job, Smith deck, twelve thousand').rest).toBe('Smith deck, twelve thousand')
    expect(parseNewJobIntent('create a new job called Maple roof').rest).toBe('Maple roof')
  })
})
