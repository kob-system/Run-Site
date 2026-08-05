// Content config for the /start welcome page (the flyer QR lands here).
//
// WHY THIS FILE EXISTS SEPARATELY: 500 brochures are already printed with
// getjobtally.com/josh on them. The URL can never change. The videos behind it
// aren't filmed yet. So everything that will change later lives here, in one
// small file — drop an id in, redeploy, done. No reprint, no page rewrite, no
// hunting through JSX.
//
// Two ways to point at a video, pick either per slot:
//   { kind: 'youtube', id: 'AbC123' }        ← unlisted YouTube upload
//   { kind: 'file', src: '/videos/intro.mp4' } ← an mp4 dropped in public/videos
// Leave `video: null` and the page renders the written version of that step —
// a complete, standalone page, NOT a "coming soon" apology.

export const VIDEOS = {
  intro: {
    video: null,
    // Shown as the player's caption once a video exists.
    title: 'What JobTally is, from the guy who built it',
    // Roughly how long, so nobody has to guess before tapping play.
    length: '',
  },
  howto: {
    video: null,
    title: 'Setting it up — start to finish',
    length: '',
  },
}

// Who handed them the card. Keyed by the ?ref= code already captured in App.js
// and folded into signup attribution. A code with no entry here just doesn't
// render a badge — better a missing name than a wrong one.
export const REFERRERS = {
  josh: {
    name: 'Josh',
    company: 'First Class Property Services',
    // Shown under the badge. Keep it to one honest line.
    line: 'He runs his own jobs on JobTally.',
    // TRUE ONLY FOR THE PRINTED BROCHURE: it says "free week, no card" and the
    // real trial is 30 days WITH a card. The page corrects it out loud rather
    // than letting them find out at the Stripe screen. Delete this flag on any
    // future print run that has the right copy on it.
    printedTrialIsWrong: true,
  },
}

// What JP covers in the intro — doubles as the written version while the video
// is null, and as "what's in this video" once it isn't.
export const INTRO_POINTS = [
  {
    q: 'What it is',
    a: "One app that keeps score on a job while it's running. Crew hours, receipts, and what's actually left for you — on the phone that's already in your pocket.",
  },
  {
    q: 'Who it\'s for',
    a: 'Owner-operators running a 2–10 man crew. Remodelers, GCs, roofers, property services. If you\'re bidding, buying material, and paying guys, it fits.',
  },
  {
    q: 'What it replaces',
    a: 'The spiral notebook of hours and the plastic sheet of receipts in the truck. And the "pretty sure we made money on that one" answer.',
  },
  {
    q: 'What it costs',
    a: '$150/mo flat. Unlimited crew, every feature, no per-seat games. $1,200 if you pay for the year.',
  },
]

// The real setup order inside the app. This is the how-to in text — it stays on
// the page under the video, because a man standing in a driveway with one bar
// of signal is going to read it, not stream it.
export const SETUP_STEPS = [
  {
    title: 'Make your account',
    body: 'Email and a password. Takes a minute. You land in the app with a sample job already in it so you can poke at something real before you touch your own numbers.',
  },
  {
    title: 'Put in one real job',
    body: 'Your last one, or the one you\'re on now. Name it, put the contract price in, and set the budget — material, labor, and what you want to walk away with.',
  },
  {
    title: 'Invite your guys',
    body: 'Text them the invite link. They install nothing complicated, they see no money — just the jobs they\'re assigned to and a clock-in button. Assign them to the job or they can\'t clock in.',
  },
  {
    title: 'Snap the next receipt at the register',
    body: 'Photo of the receipt. It reads the store, the total, the sales tax and the date, and you tap which job it belongs to. That\'s the whole habit.',
  },
  {
    title: 'Check the number Friday',
    body: 'Open the job. Labor spent, material spent, what\'s left. If it\'s bleeding you\'ll see it in week one instead of at tax time.',
  },
]
