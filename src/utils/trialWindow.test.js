import { canStartJob, isOnFreeTier, FREE_ACTIVE_JOBS } from './trialWindow'

// These assertions mirror the RLS policies in FIX-DATABASE-25 one-for-one.
// If one side changes without the other, an owner gets a button that throws —
// so this file exists to make that drift fail here instead of in his truck.
//
// The SQL being mirrored:
//   INSERT  with check ( has_app_access(uid) OR active_real_jobs(uid) = 0 )
//   UPDATE  with check ( has_app_access(uid) OR active_real_jobs(uid) <= 1
//                        OR stage = 'end' )

describe('free tier — one active job, forever', () => {
  it('lets a free owner start their first job', () => {
    expect(canStartJob({ paid: false, activeJobs: 0 })).toBe(true)
  })

  it('refuses a SECOND job on the free plan — the whole feature', () => {
    expect(canStartJob({ paid: false, activeJobs: 1 })).toBe(false)
  })

  it('frees the slot again once the job is finished', () => {
    // Finishing moves the job to stage 'end', which drops it out of the count
    // on both sides. This is the loop JP described: run one, finish it, run
    // the next one, free, forever.
    expect(canStartJob({ paid: false, activeJobs: 1 })).toBe(false)
    expect(canStartJob({ paid: false, activeJobs: 0 })).toBe(true)
  })

  it('never limits a paying or trialing owner', () => {
    expect(canStartJob({ paid: true, activeJobs: 0 })).toBe(true)
    expect(canStartJob({ paid: true, activeJobs: 7 })).toBe(true)
  })

  it('still refuses when a lapsed owner is over the limit', () => {
    // They keep read access and can always FINISH a job (enforced in SQL, not
    // here) — but they cannot open another one.
    expect(canStartJob({ paid: false, activeJobs: 3 })).toBe(false)
  })

  it('treats missing/undefined job counts as zero rather than throwing', () => {
    expect(canStartJob({ paid: false })).toBe(true)
    expect(canStartJob({ paid: false, activeJobs: null })).toBe(true)
  })

  it('keeps the free allowance at exactly one job', () => {
    // A bare constant check, on purpose: if someone bumps this to 2 they must
    // also change active_real_jobs()'s thresholds in FIX-DATABASE-25.
    expect(FREE_ACTIVE_JOBS).toBe(1)
  })

  it('identifies who is living on the free tier, for copy only', () => {
    expect(isOnFreeTier({ paid: false, activeJobs: 1 })).toBe(true)
    expect(isOnFreeTier({ paid: true, activeJobs: 1 })).toBe(false)
    expect(isOnFreeTier({ paid: false, activeJobs: 5 })).toBe(false)
  })
})
