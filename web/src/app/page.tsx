'use client'

import { useEffect, useState } from 'react'
import { getServerUrl } from '@/lib/config'

export default function HomePage() {
  const [serverUrl, setServerUrl] = useState('')

  useEffect(() => {
    setServerUrl(getServerUrl())
  }, [])

  return (
    <main className="homePage">
      <section className="homeHero">
        <div className="homeHeroCopy">
          <span className="eyebrow">Match night starts here</span>
          <h1>Keep score.<br /><em>Stay in the game.</em></h1>
          <p>Fast, live darts scoring for the board in front of you and the friends across the world.</p>
          <div className="homeHeroActions">
            <a className="btn btnPrimary homeMainAction" href="/create">Start a match <span aria-hidden="true">&rarr;</span></a>
            <a className="btn homeMainAction" href="/join">Join with a code</a>
          </div>
        </div>

        <div className="homeBoardStage" aria-hidden="true">
          <div className="homeBoard">
            <span className="homeBoardRing homeBoardRingOne" />
            <span className="homeBoardRing homeBoardRingTwo" />
            <span className="homeBoardRing homeBoardBull" />
            <span className="homeDart homeDartOne" />
            <span className="homeDart homeDartTwo" />
            <span className="homeDart homeDartThree" />
          </div>
          <div className="homeBoardCaption"><b>501</b><span>Double out<br />Best of 5</span></div>
        </div>
      </section>

      <section className="homeLiveStrip">
        <div><span className="liveDot" /> Ready to throw</div>
        <a href="/lobbies">Browse public tables <span aria-hidden="true">&rarr;</span></a>
      </section>

      <section className="homeModeRail" aria-label="More ways to play">
        <a href="/daily-checkout"><span>01</span><strong>Daily checkout</strong><small>One finish. One chance.</small></a>
        <a href="/tournaments"><span>02</span><strong>Tournaments</strong><small>Build a knockout bracket.</small></a>
        <a href="/account"><span>03</span><strong>Your form</strong><small>Stats, friends and boards.</small></a>
      </section>

      <div className="homeEndpoint">Connected to <span>{serverUrl || 'automatic server'}</span></div>
    </main>
  )
}
