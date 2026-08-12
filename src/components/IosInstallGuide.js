import React from 'react'

// The iPhone walkthrough, drawn.
//
// Why a diagram and not three lines of text: Apple ships no install API, so on
// iPhone we cannot do it FOR them — the best we can do is make the manual steps
// impossible to get wrong. And the step people actually get stuck on isn't
// understanding the instruction, it's finding the button. "Tap Share" means
// nothing to a guy who has never once thought about the little square with the
// arrow coming out of it. So each step is a picture of his own screen with the
// thing to tap circled in orange.
//
// Everything here is inline SVG on purpose: no image files to load, no CDN, it
// scales on any screen, and it stays sharp on a cracked phone in a truck.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'
const SCREEN = '#F2F4F7'
const CHROME = '#E3E6EA'

// A phone body. Everything else draws inside the 12,14 → 148,286 screen box.
function Phone({ children }) {
  return (
    <>
      <rect x="4" y="4" width="152" height="292" rx="20" fill="white" stroke={NAVY} strokeWidth="3" />
      <rect x="12" y="14" width="136" height="272" rx="12" fill={SCREEN} />
      <rect x="58" y="8" width="44" height="7" rx="3.5" fill={NAVY} />
      {children}
    </>
  )
}

// The orange "tap this" ring.
//
// Deliberately a ring and NOT a ring-plus-arrow: inside a 160-wide phone there
// is nowhere to put an arrow that doesn't end up drawn through the address bar
// or across the label it's pointing at. A ring can't collide with anything.
function Tap({ cx, cy, r = 15 }) {
  return <circle cx={cx} cy={cy} r={r} fill="none" stroke={ORANGE} strokeWidth="3" />
}

// Step 1 — Safari, with the Share button ringed in the bottom toolbar.
function StepFindShare() {
  return (
    <svg viewBox="0 0 160 300" width="100%" height="100%" role="img" aria-label="Safari on an iPhone with the Share button at the bottom of the screen circled">
      <Phone>
        {/* the page itself */}
        <text x="80" y="86" textAnchor="middle" fontSize="15" fontWeight="800" fill={NAVY}>JobTally</text>
        <rect x="34" y="98" width="92" height="5" rx="2.5" fill="#CBD2DA" />
        <rect x="44" y="110" width="72" height="5" rx="2.5" fill="#CBD2DA" />
        <rect x="40" y="132" width="80" height="16" rx="8" fill={ORANGE} opacity="0.35" />

        {/* Safari's bottom chrome: address pill, then the toolbar row */}
        <rect x="12" y="212" width="136" height="74" rx="12" fill={CHROME} />
        <rect x="24" y="222" width="112" height="20" rx="10" fill="white" />
        <text x="80" y="236" textAnchor="middle" fontSize="9" fill="#6b7280">getjobtally.com</text>

        {/* toolbar icons — back, forward, SHARE, bookmarks, tabs */}
        <path d="M32 264 l-6 -6 l6 -6" stroke="#9aa4b0" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 252 l6 6 l-6 6" stroke="#9aa4b0" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* the share glyph itself */}
        <g stroke="#007AFF" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M80 250 v13" />
          <path d="M75.5 254 L80 249.5 L84.5 254" />
          <path d="M72 258 v6.5 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 V258" />
        </g>
        <path d="M104 251 h10 v14 h-10 z" stroke="#9aa4b0" strokeWidth="2.2" fill="none" strokeLinejoin="round" />
        <rect x="126" y="251" width="12" height="12" rx="2.5" stroke="#9aa4b0" strokeWidth="2.2" fill="none" />

        <Tap cx={80} cy={258} r={16} />
      </Phone>
    </svg>
  )
}

// Step 2 — the share sheet, with Add to Home Screen ringed.
function StepAddToHome() {
  return (
    <svg viewBox="0 0 160 300" width="100%" height="100%" role="img" aria-label="The iPhone share menu open, with Add to Home Screen circled">
      <Phone>
        <text x="80" y="60" textAnchor="middle" fontSize="12" fontWeight="700" fill="#B6BEC8">JobTally</text>

        {/* the sheet */}
        <rect x="12" y="96" width="136" height="190" rx="14" fill="white" stroke="#D8DDE3" strokeWidth="1.5" />
        <rect x="66" y="104" width="28" height="4" rx="2" fill="#D8DDE3" />

        {/* a couple of ordinary rows above it, so the highlighted one reads as
            "keep scrolling until you see this" rather than "it's first" */}
        <rect x="24" y="122" width="112" height="24" rx="7" fill={SCREEN} />
        <text x="34" y="138" fontSize="9" fill="#8A929C">Copy</text>
        <rect x="24" y="152" width="112" height="24" rx="7" fill={SCREEN} />
        <text x="34" y="168" fontSize="9" fill="#8A929C">Add Bookmark</text>

        {/* the one that matters */}
        <rect x="24" y="182" width="112" height="30" rx="8" fill="#FFF2E6" stroke={ORANGE} strokeWidth="2" />
        <rect x="31" y="190" width="14" height="14" rx="3.5" stroke={NAVY} strokeWidth="1.8" fill="none" />
        <path d="M38 193.5 v7 M34.5 197 h7" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <text x="50" y="202" fontSize="8" fontWeight="800" fill={NAVY}>Add to Home Screen</text>

        <rect x="24" y="218" width="112" height="24" rx="7" fill={SCREEN} />
        <text x="34" y="234" fontSize="9" fill="#8A929C">Find on Page</text>

      </Phone>
    </svg>
  )
}

// Step 3 — the confirm dialog, then the icon sitting on the home screen.
function StepConfirm() {
  return (
    <svg viewBox="0 0 160 300" width="100%" height="100%" role="img" aria-label="Tapping Add, and the JobTally icon appearing on the iPhone home screen">
      <Phone>
        {/* the naming dialog */}
        <rect x="20" y="40" width="120" height="76" rx="12" fill="white" stroke="#D8DDE3" strokeWidth="1.5" />
        <text x="30" y="58" fontSize="8.5" fill="#8A929C">Cancel</text>
        <rect x="106" y="48" width="26" height="14" rx="7" fill={ORANGE} />
        <text x="119" y="58" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="white">Add</text>
        <rect x="30" y="76" width="24" height="24" rx="6" fill={NAVY} />
        <text x="42" y="92" textAnchor="middle" fontSize="9" fontWeight="800" fill="white">JT</text>
        <rect x="62" y="82" width="60" height="6" rx="3" fill="#E3E6EA" />
        <rect x="62" y="92" width="40" height="5" rx="2.5" fill="#EEF0F3" />

        <Tap cx={119} cy={55} r={13} />

        {/* and it lands on the home screen */}
        <text x="80" y="150" textAnchor="middle" fontSize="8.5" fill="#8A929C">and it's on your phone</text>
        <g>
          <rect x="26" y="164" width="26" height="26" rx="7" fill="#C9D0D8" />
          <rect x="67" y="164" width="26" height="26" rx="7" fill="#C9D0D8" />
          <rect x="108" y="164" width="26" height="26" rx="7" fill={NAVY} />
          <text x="121" y="181" textAnchor="middle" fontSize="10" fontWeight="800" fill="white">JT</text>
          <text x="121" y="204" textAnchor="middle" fontSize="7" fill="#6b7280">JobTally</text>
          <circle cx="121" cy="177" r="18" fill="none" stroke={ORANGE} strokeWidth="2.5" />
        </g>
      </Phone>
    </svg>
  )
}

const STEPS = [
  { n: 1, Art: StepFindShare, title: 'Tap Share', body: <>It's the little square with the arrow coming out of it, at the <strong>bottom</strong> of the screen.</> },
  { n: 2, Art: StepAddToHome, title: 'Tap “Add to Home Screen”', body: <>It's partway down the list — <strong>scroll down</strong> a little if you don't see it.</> },
  { n: 3, Art: StepConfirm, title: 'Tap “Add”', body: <>Top right corner. That's it — JobTally is on your phone.</> },
]

export default function IosInstallGuide() {
  return (
    <div>
      {STEPS.map(({ n, Art, title, body }) => (
        <div key={n} style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ flex: '0 0 96px', height: 180 }}>
            <Art />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ flex: '0 0 24px', height: 24, borderRadius: 12, background: NAVY, color: 'white', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
              <span style={{ fontSize: 15.5, fontWeight: 800, color: NAVY }}>{title}</span>
            </div>
            <div style={{ fontSize: 13.5, color: '#5b6672', lineHeight: 1.5 }}>{body}</div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12.5, color: '#9ca3af', lineHeight: 1.5 }}>
        No Share button at the bottom? You're probably in Facebook or Instagram's built-in browser —
        tap the ••• and choose <strong>Open in Safari</strong> first. On an iPad, Share sits at the
        <strong> top</strong> instead.
      </div>
    </div>
  )
}
