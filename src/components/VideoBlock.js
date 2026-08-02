import React from 'react'
import './VideoBlock.css'
import { VIDEOS } from '../videoConfig'

// Reusable public-page video section. Ships its own CSS so it looks identical
// on Landing (/), Remodelers (/remodelers) and HowItWorks (/how-it-works)
// instead of depending on whichever page's stylesheet happens to be loaded.
//
// Renders NOTHING when the video isn't ready yet (see videoConfig.js) — a
// missing file must never turn into a broken player on a stranger's first
// visit. preload="none" means nothing downloads until they hit play.
export default function VideoBlock({ name, heading, kicker, footer, onPlay }) {
  const v = VIDEOS[name]
  if (!v || !v.ready) return null

  return (
    <section className="vb">
      <div className="vb-inner">
        <h2>{heading || v.heading}</h2>
        {(kicker || v.kicker) && <p className="vb-kicker">{kicker || v.kicker}</p>}
        <div className="vb-frame">
          <video
            controls
            playsInline
            preload="none"
            poster={v.poster}
            src={v.src}
            onPlay={onPlay}
          >
            Your browser can't play this video.
          </video>
        </div>
        {footer && <div className="vb-footer">{footer}</div>}
      </div>
    </section>
  )
}
