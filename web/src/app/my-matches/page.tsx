'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import { hostProofsForBrowser, rememberRoomRole, roomDeviceKey } from '@/lib/room-session'

type OpenMatch = {
  code: string
  title: string
  gameType: 'X01' | 'AROUND'
  startScore?: number
  status: 'LOBBY' | 'LIVE'
  role: 'HOST' | 'PLAYER'
  players: string[]
  lastPlayedAt: number
}

export default function MyMatchesPage() {
  const [matches, setMatches] = useState<OpenMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const authToken = localStorage.getItem('dc_authToken') || undefined
      const socket = getSocket(getServerUrl())
      const credentials = { deviceKey: roomDeviceKey(), hostProofs: hostProofsForBrowser() }
      let result = await socket.emitWithAck('rooms:listMine', { ...credentials, authToken })
      if (result?.code === 'AUTH_INVALID') result = await socket.emitWithAck('rooms:listMine', credentials)
      if (!result?.ok) throw new Error(result?.message ?? 'Could not load your matches.')
      setSignedIn(Boolean(localStorage.getItem('dc_authToken')))
      setMatches(result.matches)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your matches.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <main className="col overviewPage">
      <header className="card overviewHero">
        <div className="overviewIdentity">
          <span className="eyebrow">Pick up where you left off</span>
          <h1 className="title">My matches</h1>
          <p className="subtitle">Open rooms from this browser and matches linked to your account.</p>
        </div>
        <Link className="btn btnPrimary" href="/create"><Icon name="plus" /> New match</Link>
      </header>

      <div className="row spread">
        <h2 className="sectionTitle">Open matches</h2>
        <button type="button" className="btn" disabled={loading} onClick={() => void refresh()}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {error ? <p className="formError" role="status">{error}</p> : null}
      {!loading && !error && matches.length === 0 ? <section className="card col lobbyEmpty">
        <h3 className="sectionTitle">No open matches yet</h3>
        <p className="help sectionMuted">Start a match or join one with a room code. Saved matches will appear here.</p>
        <div className="row"><Link className="btn" href="/join">Join with code</Link>{!signedIn ? <Link className="btn" href="/account">Sign in</Link> : null}</div>
      </section> : null}

      <div className="grid2" aria-busy={loading}>
        {matches.map((match) => {
          const live = match.status === 'LIVE'
          const format = match.gameType === 'AROUND' ? 'Around the Board' : `${match.startScore ?? 'X01'}${match.startScore ? ' X01' : ''}`
          return <article className="card col sectionCard" key={match.code}>
            <div className="row"><span className="pill">{live ? 'In progress' : 'In lobby'}</span><span className="pill">{match.role === 'HOST' ? 'Host' : 'Player'}</span></div>
            <h3 className="sectionTitle">{match.title || format}</h3>
            <div className="row"><span className="help">{format} · {match.code}</span></div>
            <p className="help sectionMuted">{match.players.join(' · ') || 'No players yet'}</p>
            <div className="row spread">
              <time className="help" dateTime={new Date(match.lastPlayedAt).toISOString()}>{new Date(match.lastPlayedAt).toLocaleDateString()}</time>
              <Link className={live ? 'btn btnPrimary' : 'btn'} href={`/room/${match.code}/${live ? 'game' : 'lobby'}`} onClick={() => rememberRoomRole(match.code, 'PLAYER')}>{live ? 'Resume match' : 'Open lobby'} <Icon name="arrow" /></Link>
            </div>
          </article>
        })}
      </div>
    </main>
  )
}
