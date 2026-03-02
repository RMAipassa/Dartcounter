'use client'

import { useEffect, useState } from 'react'
import { getServerUrl } from '@/lib/config'

export default function HomePage() {
  const [isMobile, setIsMobile] = useState(false)
  const [serverUrl, setServerUrl] = useState<string>('')

  useEffect(() => {
    setServerUrl(getServerUrl())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 520px)')
    const onChange = () => setIsMobile(Boolean(mq.matches))
    onChange()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 className="title">Dartcounter Web</h1>
          <p className="subtitle">{isMobile ? 'Pick where you want to go.' : 'Create matches, join rooms, and play with friends.'}</p>
        </div>
        <span className="pill">Server: {serverUrl || 'auto'}</span>
      </div>

      <div className="mobileHomeTiles">
        <a className="mobileHomeTile" href="/create">
          <span className="mobileHomeTileIcon mobileHomeTileIconRose">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="12" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            </svg>
          </span>
          <span className="mobileHomeTileTitle">New Match</span>
          <span className="mobileHomeTileSub">Create a lobby</span>
        </a>
        <a className="mobileHomeTile" href="/join">
          <span className="mobileHomeTileIcon mobileHomeTileIconGold">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 5h12v2a6 6 0 0 1-4 5.64V16h3v2H7v-2h3v-3.36A6 6 0 0 1 6 7V5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="mobileHomeTileTitle">Join Lobby</span>
          <span className="mobileHomeTileSub">Enter room code</span>
        </a>
        <a className="mobileHomeTile" href="/lobbies">
          <span className="mobileHomeTileIcon mobileHomeTileIconMint">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="8" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="16" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4 18a4 4 0 0 1 8 0M12 18a4 4 0 0 1 8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <span className="mobileHomeTileTitle">Public Lobbies</span>
          <span className="mobileHomeTileSub">Browse open rooms</span>
        </a>
        <a className="mobileHomeTile" href="/account">
          <span className="mobileHomeTileIcon mobileHomeTileIconBlue">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 17V9m6 8V5m6 12v-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </span>
          <span className="mobileHomeTileTitle">Account</span>
          <span className="mobileHomeTileSub">Friends and stats</span>
        </a>
      </div>

    </div>
  )
}
