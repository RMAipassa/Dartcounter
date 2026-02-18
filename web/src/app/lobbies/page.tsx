'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
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
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    setServerUrl(getServerUrl())
    setName(localStorage.getItem('dc_name') ?? '')
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('rooms:listPublic')
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')
      setRooms(res.rooms ?? [])
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!serverUrl) return
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl])

  async function join(code: string, asSpectator: boolean) {
    try {
      if (!name.trim()) throw new Error('Enter your name first')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('room:join', { code, name, asSpectator })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')
      localStorage.setItem('dc_name', name)
      localStorage.setItem('dc_role', res.role ?? (asSpectator ? 'SPECTATOR' : 'PLAYER'))
      router.push(`/room/${code}/lobby`)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Public lobbies</h1>
          <p className="subtitle">Join a lobby without a code. Private lobbies still require a code.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <a className="btn" href="/">
            Home
          </a>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="help">Your name (used for player list)</div>
          <span className="pill">Server: {serverUrl}</span>
        </div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ruben" />
      </div>

      <div className="col" style={{ gap: 12 }}>
        {rooms.length === 0 ? (
          <div className="card" style={{ padding: 16 }}>
            <div className="help">No public lobbies right now.</div>
          </div>
        ) : null}

        {rooms.map((r) => (
          <div key={r.code} className="card" style={{ padding: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div className="col" style={{ gap: 6 }}>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="pill" style={{ color: 'var(--text)' }}>{r.title || 'Untitled lobby'}</span>
                  <span className="pill">Code: {r.code}</span>
                  <span className="pill">{r.status}</span>
                  <span className="pill">Players: {r.playersCount}</span>
                  <span className="pill">Online: {r.clientsCount}</span>
                  <span className="pill">Age: {fmtAge(Date.now() - r.createdAt)}</span>
                </div>
                <div className="help">Public lobby</div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => join(r.code, false)}>
                  Join as player
                </button>
                <button className="btn" onClick={() => join(r.code, true)}>
                  Spectate
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
