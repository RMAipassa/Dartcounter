'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import { hostSecretForRoom, rememberHostSecret, rememberRoomIdentity, roomDeviceKey } from '@/lib/room-session'
import type { PublicRoom } from '@/lib/types'

function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h`
}

export default function PublicLobbiesPage() {
  const router = useRouter()
  const [serverUrl, setServerUrl] = useState('')
  const [rooms, setRooms] = useState<PublicRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const refreshing = useRef(false)
  const [toast, setToast] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null)

  useEffect(() => {
    setServerUrl(getServerUrl())
    const signedName = localStorage.getItem('dc_authDisplayName')
    if (signedName) {
      setAuthDisplayName(signedName)
      setName(signedName)
    } else {
      setName(localStorage.getItem('dc_name') ?? '')
    }
  }, [])

  const effectiveName = authDisplayName?.trim() ? authDisplayName : name

  async function refresh(showLoading = true) {
    if (!serverUrl || refreshing.current) return
    refreshing.current = true
    if (showLoading) setLoading(true)
    try {
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('rooms:listPublic')
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')
      setRooms(res.rooms ?? [])
      setLoadError(null)
    } catch (e: any) {
      setLoadError(e?.message ?? String(e))
    } finally {
      refreshing.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!serverUrl) return
    refresh()
    const t = setInterval(() => { if (!document.hidden) void refresh(false) }, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl])

  async function join(code: string, asSpectator: boolean) {
    if (joining) return
    setJoining(true)
    try {
      if (!effectiveName.trim()) throw new Error('Enter your name first')
      const socket = getSocket(serverUrl)
      const authToken = localStorage.getItem('dc_authToken') ?? undefined
      const res = await socket.emitWithAck('room:join', { code, name: effectiveName, authToken, asSpectator, hostSecret: hostSecretForRoom(code) ?? undefined, deviceKey: roomDeviceKey() })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')
      localStorage.setItem('dc_name', effectiveName)
      if (res.hostSecret) rememberHostSecret(code, res.hostSecret)
      rememberRoomIdentity(code, effectiveName, res.role ?? (asSpectator ? 'SPECTATOR' : 'PLAYER'))
      router.push(`/room/${code}/lobby`)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    } finally {
      setJoining(false)
    }
  }

  return (
    <main className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span className="eyebrow">Play online</span>
          <h1 className="title">Public lobbies</h1>
          <p className="subtitle">Join a lobby without a code. Private lobbies still require a code.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <Link className="btn" href="/join">Join with code</Link>
          <Link className="btn" href="/my-matches">My matches</Link>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        {authDisplayName ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="pill" style={{ color: 'var(--text)' }}>{authDisplayName}</span>
            <span className="help">From your account</span>
          </div>
        ) : (
          <label className="col help">Player name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" autoComplete="nickname" maxLength={32} />
          </label>
        )}
      </div>

      <div className="col" style={{ gap: 12 }}>
        {loadError ? <p className="formError" role="status">Couldn’t refresh public lobbies. {loadError}</p> : null}
        {!loadError && rooms.length === 0 ? (
          <div className="card col lobbyEmpty">
            <h2 className="sectionTitle">{loading ? 'Looking for lobbies…' : 'No public lobbies right now'}</h2>
            {!loading ? <><div className="help">Start your own match or join a private room with a code.</div><div className="row"><Link className="btn btnPrimary" href="/create">New match</Link></div></> : null}
          </div>
        ) : null}

        {rooms.map((r) => (
          <div key={r.code} className="card" style={{ padding: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div className="col" style={{ gap: 6 }}>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <h2 className="sectionTitle">{r.title || 'Untitled lobby'}</h2>
                </div>
                <div className="row">
                  <span className="pill">Code: {r.code}</span>
                  <span className="pill">{r.status === 'LIVE' ? 'In progress' : r.status === 'FINISHED' ? 'Finished' : 'Open'}</span>
                  <span className="pill">Players: {r.playersCount}</span>
                  <span className="pill">Online: {r.clientsCount}</span>
                  <span className="pill">Age: {fmtAge(Date.now() - r.createdAt)}</span>
                </div>
                <div className="help">Public lobby</div>
              </div>
              <div className="row">
                <button className="btn btnPrimary" disabled={joining || !effectiveName.trim()} onClick={() => join(r.code, false)}>
                  Join as player
                </button>
                <button className="btn" disabled={joining || !effectiveName.trim()} onClick={() => join(r.code, true)}>
                  Spectate
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  )
}
