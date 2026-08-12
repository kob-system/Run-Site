import React from 'react'

// The iPhone walkthrough, drawn.
//
// Why a diagram and not three lines of text: Apple ships no install API, so on
// iPhone we cannot do it FOR them — the best available move is making the manual
// steps impossible to get wrong. And what people get stuck on isn't understanding
// the instruction, it's finding the button.
//
// ⚠️ THESE STEPS WERE CORRECTED AGAINST A REAL iPHONE (JP's, 2026-08-11). The
// first version drew the older iOS layout — Share sitting straight in the bottom
// toolbar — and that is NOT what current iOS does. The real path he walked:
//   ••• at the bottom right  →  Share  →  scroll / "More"  →  Add to Home Screen
// Older iPhones do still show the Share arrow directly in the bottom bar, so the
// note under the steps tells those users to skip ahead rather than hunt for a
// ••• that isn't there.
//
// Do not "simplify" this back to three steps from memory of how iOS used to
// work. It was wrong once already, and the entire value of this component is
// that it matches the screen in the guy's hand.
//
// Inline SVG on purpose: no image files, no CDN, sharp at any size.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'
const SCREEN = '#F2F4F7'
const CHROME = '#E3E6EA'
const MUTED = '#8A929C'

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

// The page behind whatever sheet is open, so every panel still reads as
// "your phone, on our website."
function PageBehind({ dim }) {
  if (dim) {
    return <text x="80" y="60" textAnchor="middle" fontSize="12" fontWeight="700" fill="#B6BEC8">JobTally</text>
  }
  return (
    <>
      <text x="80" y="86" textAnchor="middle" fontSize="15" fontWeight="800" fill={NAVY}>JobTally</text>
      <rect x="34" y="98" width="92" height="5" rx="2.5" fill="#CBD2DA" />
      <rect x="44" y="110" width="72" height="5" rx="2.5" fill="#CBD2DA" />
      <rect x="40" y="132" width="80" height="16" rx="8" fill={ORANGE} opacity="0.35" />
    </>
  )
}

// Step 1 — Safari's bottom bar, with the ••• at the bottom right ringed.
function StepDots() {
  return (
    <svg viewBox="0 0 160 300" width="100%" height="100%" role="img" aria-label="Safari on an iPhone with the three-dots button at the bottom right circled">
      <Phone>
        <PageBehind />
        {/* Safari's bottom chrome: address pill, then the ••• on its right */}
        <rect x="12" y="212" width="136" height="74" rx="12" fill={CHROME} />
        <rect x="22" y="222" width="86" height="20" rx="10" fill="white" />
        <text x="65" y="236" textAnchor="middle" fontSize="7.5" fill="#6b7280">getjobtally.com</text>
        <rect x="114" y="222" width="24" height="20" rx="7" fill="white" />
        <circle cx="120" cy="232" r="1.7" fill="#3A4552" />
        <circle cx="126" cy="232" r="1.7" fill="#3A4552" />
        <circle cx="132" cy="232" r="1.7" fill="#3A4552" />

        {/* the rest of the toolbar, greyed — not what they want */}
        <path d="M32 264 l-6 -6 l6 -6" stroke="#B4BCC6" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 252 l6 6 l-6 6" stroke="#B4BCC6" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M104 251 h10 v14 h-10 z" stroke="#B4BCC6" strokeWidth="2.2" fill="none" strokeLinejoin="round" />
        <rect x="126" y="251" width="12" height="12" rx="2.5" stroke="#B4BCC6" strokeWidth="2.2" fill="none" />

        <Tap cx={126} cy={232} r={15} />
      </Phone>
    </svg>
  )
}

// Step 2 — the ••• menu, with Share ringed.
function StepShare() {
  return (
    <svg viewBox="0 0 160 300" width="100%" height="100%" role="img" aria-label="The iPhone Safari menu open with Share circled">
      <Phone>
        <PageBehind dim />
        <rect x="12" y="120" width="136" height="166" rx="14" fill="white" stroke="#D8DDE3" strokeWidth="1.5" />
        <rect x="66" y="128" width="28" height="4" rx="2" fill="#D8DDE3" />

        <rect x="24" y="144" width="112" height="24" rx="7" fill={SCREEN} />
        <text x="34" y="160" fontSize="8.5" fill={MUTED}>Add to Favorites</text>
        <rect x="24" y="174" width="112" height="24" rx="7" fill={SCREEN} />
        <text x="34" y="190" fontSize="8.5" fill={MUTED}>Find on Page</text>

        {/* the one they want */}
        <rect x="24" y="204" width="112" height="30" rx="8" fill="#FFF2E6" stroke={ORANGE} strokeWidth="2" />
        <g stroke={NAVY} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M36 212 v10" />
          <path d="M32.5 215 L36 211.5 L39.5 215" />
          <path d="M30 218 v5 a1.6 1.6 0 0 0 1.6 1.6 h8.8 a1.6 1.6 0 0 0 1.6 -1.6 V218" />
        </g>
        <text x="54" y="223" fontSize="9" fontWeight="800" fill={NAVY}>Share</text>

        <rect x="24" y="240" width="112" height="24" rx="7" fill={SCREEN} />
        <text x="34" y="256" fontSize="8.5" fill={MUTED}>Print</text>

        <Tap cx={36} cy={219} r={12} />
      </Phone>
    </svg>
  )
}

// Step 3 — the share sheet. Add to Home Screen sits DOWN the list, past the
// app icons, which is exactly where people quit — so the panel shows it below
// the apps with the "More" row underneath it.
function StepAddToHome() {
  return (
    <svg viewBox="0 0 160 300" width="100%" height="100%" role="img" aria-label="The iPhone share sheet scrolled down to Add to Home Screen, circled">
      <Phone>
        <PageBehind dim />
        <rect x="12" y="96" width="136" height="190" rx="14" fill="white" stroke="#D8DDE3" strokeWidth="1.5" />
        <rect x="66" y="104" width="28" height="4" rx="2" fill="#D8DDE3" />

        {/* the row of app icons at the top of every share sheet */}
        <circle cx="34" cy="128" r="10" fill="#DDE2E8" />
        <circle cx="60" cy="128" r="10" fill="#DDE2E8" />
        <circle cx="86" cy="128" r="10" fill="#DDE2E8" />
        <circle cx="112" cy="128" r="10" fill="#DDE2E8" />

        <rect x="24" y="148" width="112" height="22" rx="7" fill={SCREEN} />
        <text x="34" y="163" fontSize="8" fill={MUTED}>Copy</text>
        <rect x="24" y="174" width="112" height="22" rx="7" fill={SCREEN} />
        <text x="34" y="189" fontSize="8" fill={MUTED}>Add to Reading List</text>

        {/* the one that matters */}
        <rect x="24" y="200" width="112" height="30" rx="8" fill="#FFF2E6" stroke={ORANGE} strokeWidth="2" />
        <rect x="31" y="208" width="14" height="14" rx="3.5" stroke={NAVY} strokeWidth="1.8" fill="none" />
        <path d="M38 211.5 v7 M34.5 215 h7" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <text x="54" y="220" fontSize="8" fontWeight="800" fill={NAVY}>Add to Home Screen</text>

        {/* and the More row underneath, because that's where it hides */}
        <rect x="24" y="236" width="112" height="22" rx="7" fill={SCREEN} />
        <text x="34" y="251" fontSize="8" fill={MUTED}>Edit Actions… / More</text>

        <Tap cx={38} cy={215} r={12} />
      </Phone>
    </svg>
  )
}

// Step 4 — the confirm dialog, then the icon sitting on the home screen.
function StepConfirm() {
  return (
    <svg viewBox="0 0 160 300" width="100%" height="100%" role="img" aria-label="Tapping Add, and the JobTally icon appearing on the iPhone home screen">
      <Phone>
        <rect x="20" y="40" width="120" height="76" rx="12" fill="white" stroke="#D8DDE3" strokeWidth="1.5" />
        <text x="30" y="58" fontSize="8.5" fill={MUTED}>Cancel</text>
        <rect x="106" y="48" width="26" height="14" rx="7" fill={ORANGE} />
        <text x="119" y="58" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="white">Add</text>
        <rect x="30" y="76" width="24" height="24" rx="6" fill={NAVY} />
        <text x="42" y="92" textAnchor="middle" fontSize="9" fontWeight="800" fill="white">JT</text>
        <rect x="62" y="82" width="60" height="6" rx="3" fill="#E3E6EA" />
        <rect x="62" y="92" width="40" height="5" rx="2.5" fill="#EEF0F3" />

        <Tap cx={119} cy={55} r={13} />

        <text x="80" y="150" textAnchor="middle" fontSize="8.5" fill={MUTED}>and it's on your phone</text>
        <rect x="26" y="164" width="26" height="26" rx="7" fill="#C9D0D8" />
        <rect x="67" y="164" width="26" height="26" rx="7" fill="#C9D0D8" />
        <rect x="108" y="164" width="26" height="26" rx="7" fill={NAVY} />
        <text x="121" y="181" textAnchor="middle" fontSize="10" fontWeight="800" fill="white">JT</text>
        <text x="121" y="204" textAnchor="middle" fontSize="7" fill="#6b7280">JobTally</text>
        <circle cx="121" cy="177" r="18" fill="none" stroke={ORANGE} strokeWidth="2.5" />
      </Phone>
    </svg>
  )
}

const STEPS = [
  { n: 1, Art: StepDots, title: 'Tap the •••', body: <>Bottom <strong>right</strong> corner of Safari, next to the web address.</> },
  { n: 2, Art: StepShare, title: 'Tap “Share”', body: <>It's in the menu that slides up.</> },
  { n: 3, Art: StepAddToHome, title: 'Tap “Add to Home Screen”', body: <><strong>Scroll down</strong> — it's below the row of apps. Still don't see it? Tap <strong>More</strong> at the bottom of the list.</> },
  { n: 4, Art: StepConfirm, title: 'Tap “Add”', body: <>Top right corner. That's it — JobTally is on your phone.</> },
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
        <strong>Older iPhone?</strong> If you see the Share arrow right in the bottom bar, tap that
        and skip to step 3. On an iPad, Share sits at the <strong>top</strong>. And if there's no
        ••• at all, you're in Facebook or Instagram's built-in browser — tap their ••• and choose{' '}
        <strong>Open in Safari</strong> first.
      </div>
    </div>
  )
}
