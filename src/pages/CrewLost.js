import React from 'react'

// THE DOOR BACK IN FOR A CREW MEMBER WHO ARRIVED WITHOUT HIS LINK.
//
// A passwordless crew account (api/join-invite.js) has no password and no
// reachable inbox, so the invite link his boss texted him IS his credential.
// That is fine right up until he arrives at the root of the site carrying no
// token — and there are two ordinary ways that happens every week:
//
//   1. He put JobTally on his home screen. The icon opens manifest start_url,
//      which is the bare root, and on iOS a standalone web app can get a
//      storage partition separate from the Safari tab he joined in. No session,
//      no saved crew key, no token in the URL.
//   2. He bookmarked the page, or typed getjobtally.com from memory, instead of
//      scrolling back to find his boss's text.
//
// Until now both of those landed him on the CONTRACTOR MARKETING PAGE, which
// from his seat is "I tapped it and it just took me to the website." The only
// door on that page is Sign in, which is an email and password form he can
// never pass, because he has neither. Robert Place joined on 2026-08-24 and has
// clocked in zero times since; this is the screen that was missing.
//
// It is deliberately a chooser and not a crew-only screen: the owner uses the
// same home-screen icon, and if HIS session lapsed he must not be told to text
// his boss. So the crew path is loud, the owner path is right underneath it,
// and nobody is sent somewhere they cannot get through.
const NAVY = '#1C2B3A'
const ORANGE = '#E07B2A'

const SMS_BODY = 'Can you resend me my JobTally link? The one you texted me.'

export default function CrewLost() {
  const page = {
    minHeight: '100vh', background: NAVY, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '24px 16px'
  }
  const card = {
    background: 'white', borderRadius: '16px', padding: '24px', width: '100%',
    maxWidth: '440px', boxShadow: '0 12px 32px rgba(0,0,0,0.28)'
  }
  const primary = {
    display: 'block', width: '100%', minHeight: '54px', marginTop: '16px', padding: '15px',
    border: 'none', borderRadius: '10px', background: ORANGE, color: 'white', fontSize: '17px',
    fontWeight: '800', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box',
    cursor: 'pointer'
  }
  const quiet = {
    display: 'block', background: 'none', border: 'none', color: '#6B7280', fontWeight: '700',
    fontSize: '13.5px', textDecoration: 'none', padding: '10px', width: '100%',
    textAlign: 'center', cursor: 'pointer'
  }

  return (
    <div style={page}>
      <div style={card}>
        <div style={{ fontSize: '30px', marginBottom: '4px' }} aria-hidden="true">👋</div>
        <h1 style={{ color: NAVY, fontSize: '22px', lineHeight: 1.25, margin: '0 0 8px' }}>
          Welcome back. Let&rsquo;s get you to your clock.
        </h1>
        <p style={{ color: '#4B5563', fontSize: '15px', margin: 0, lineHeight: 1.5 }}>
          You don&rsquo;t have a password, and you don&rsquo;t need one. The link your boss texted
          you is your login. Open your texts and tap it, and you&rsquo;re straight back in.
        </p>

        <div style={{
          marginTop: '16px', background: '#F3F6F9', border: '1px solid #E2E8F0',
          borderRadius: '10px', padding: '12px 14px', color: '#4B5563', fontSize: '13.5px',
          lineHeight: 1.5
        }}>
          Search your messages for <strong>jobtally</strong> and it will come straight up.
        </div>

        <a href={`sms:?&body=${encodeURIComponent(SMS_BODY)}`} style={primary}>
          Can&rsquo;t find it? Text my boss
        </a>

        <p style={{
          textAlign: 'center', marginTop: '14px', marginBottom: 0,
          borderTop: '1px solid #F1F5F9', paddingTop: '12px'
        }}>
          <a href="/login" style={quiet}>I&rsquo;m the owner, sign me in</a>
        </p>
      </div>
    </div>
  )
}
