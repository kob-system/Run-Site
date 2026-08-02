// Single source of truth for the public marketing videos.
//
// Why this exists: the video files are produced outside the repo and land in
// public/landing/ whenever they're finished. Everything that renders a video
// (Landing, Remodelers, HowItWorks) reads this file, so shipping a new video is
// "drop the mp4 + poster in public/landing/, flip `ready` to true" — no JSX
// edits, no risk of a page pointing at a file that isn't there yet.
//
// `ready: false` renders NOTHING. We never ship a dead player, a "coming soon"
// box, or a placeholder poster on a public page.

export const VIDEOS = {
  // Product walkthrough — a real screen recording of the live app, chapter by
  // chapter, with a voiceover. This is the "how do I use it" video.
  howTo: {
    ready: true,
    src: '/landing/JobTally-HowTo.mp4',
    poster: '/landing/howto-poster.jpg',
    heading: 'See it run — every screen, in about five minutes',
    kicker: 'A real walkthrough of the live app, start to finish. No sign-up needed.',
  },

  // Founder intro — filmed on camera, not a screen recording. Stays hidden
  // until the file is actually in public/landing/.
  intro: {
    ready: false,
    src: '/landing/JobTally-Intro.mp4',
    poster: '/landing/intro-poster.jpg',
    heading: 'Why I built this',
    kicker: 'Two minutes, from the guy who made it.',
  },
}

export default VIDEOS
