import { matchJobFromNote, pickReceiptJob, orderJobsForPicker, guessCategory } from './receiptJob'

const JOBS = [
  { id: '1', name: 'Smith Deck', stage: 'mid' },
  { id: '2', name: 'Master Bath Reno – Klein Residence', stage: 'mid' },
  { id: '3', name: 'Jones Deck', stage: 'end' },
  { id: 's', name: 'Sample job', stage: 'mid', is_sample: true },
]

describe('matchJobFromNote', () => {
  it('finds the job his note names', () => {
    expect(matchJobFromNote('receipt for the Smith deck', JOBS).id).toBe('1')
  })
  it('matches on a surname alone', () => {
    expect(matchJobFromNote('this is for the Klein job', JOBS).id).toBe('2')
  })
  it('never picks on a trade word alone', () => {
    expect(matchJobFromNote('for the deck', JOBS)).toBeNull()
    expect(matchJobFromNote('for the deck', [{ id: '3', name: 'Jones Deck' }])).toBeNull()
  })
  it('prefers the job matching more of what he said', () => {
    const jobs = [{ id: 'a', name: 'Smith Deck' }, { id: 'b', name: 'Smith Kitchen' }]
    expect(matchJobFromNote('receipt for the smith deck', jobs).id).toBe('a')
  })
  it('does not break a tie', () => {
    const jobs = [{ id: 'a', name: 'Smith Deck' }, { id: 'b', name: 'Smith Kitchen' }]
    expect(matchJobFromNote('receipt for Smith', jobs)).toBeNull()
  })
  it('returns null for no note or no match', () => {
    expect(matchJobFromNote('', JOBS)).toBeNull()
    expect(matchJobFromNote('receipt for the Delgado basement', JOBS)).toBeNull()
  })
})

describe('pickReceiptJob only preselects when the job is clear', () => {
  it('uses the job he opened the assistant from', () => {
    expect(pickReceiptJob({ jobs: JOBS, note: '', projectId: '2' })).toEqual({ id: '2', why: 'open' })
  })
  it('uses the job his note names', () => {
    expect(pickReceiptJob({ jobs: JOBS, note: 'for the Smith deck', projectId: null })).toEqual({ id: '1', why: 'said' })
  })
  it('uses the only live job', () => {
    const jobs = [{ id: '1', name: 'Smith Deck', stage: 'mid' }, { id: '3', name: 'Jones Deck', stage: 'end' }]
    expect(pickReceiptJob({ jobs, note: '', projectId: null })).toEqual({ id: '1', why: 'only' })
  })
  it('makes him pick when two jobs are live and nothing points at one', () => {
    expect(pickReceiptJob({ jobs: JOBS, note: '', projectId: null })).toBeNull()
  })
  it('ignores an open-job id that is not on his list', () => {
    expect(pickReceiptJob({ jobs: JOBS, note: '', projectId: 'gone' })).toBeNull()
  })
})

describe('orderJobsForPicker', () => {
  it('puts live jobs first and drops the tutorial job', () => {
    expect(orderJobsForPicker(JOBS).map((j) => j.id)).toEqual(['1', '2', '3'])
  })
})

describe('guessCategory', () => {
  it('reads the obvious words', () => {
    expect(guessCategory('gas receipt for Smith')).toBe('fuel')
    expect(guessCategory('lunch for the crew')).toBe('meals')
  })
  it('defaults to materials', () => {
    expect(guessCategory('receipt for the Smith deck')).toBe('materials')
    expect(guessCategory('')).toBe('materials')
  })
})
