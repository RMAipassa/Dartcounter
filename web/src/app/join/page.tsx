'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'

export default function JoinPage() {
  const router = useRouter()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [joining, setJoining] = useState(false)
  const [name, setName] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const authName = localStorage.getItem('dc_authDisplayName')
    if (authName) {
      setAuthDisplayName(authName)
      setName(authName)
    }
  }, [])

  const effectiveName = authDisplayName?.trim() ? authDisplayName : name

  async function joinRoom(asSpectator: boolean) {
    setErr(null)
    setJoining(true)
    try {
      const socket = getSocket(serverUrl)
      const code = joinCode.trim().toUpperCase()
      const rawToken = localStorage.getItem('dc_authToken')
      const authToken = rawToken && rawToken.trim() ? rawToken.trim() : undefined
      const res = await socket.emitWithAck('room:join', {
        code,
        name: effectiveName,
        authToken,
        asSpectator,
      })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to join room')
      localStorage.setItem('dc_name', effectiveName)
      localStorage.setItem('dc_role', res.role ?? (asSpectator ? 'SPECTATOR' : 'PLAYER'))
      router.push(`/room/${code}/lobby`)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Join Lobby</h1>
          <p className="subtitle">Enter a room code and pick your role.</p>
        </div>
        <a className="btn" href="/">Home</a>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="col">
          {authDisplayName ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="help">Signed in name</div>
              <span className="pill" style={{ color: 'var(--text)' }}>{authDisplayName}</span>
            </div>
          ) : (
            <div className="col">
              <label className="help">Your name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ruben" />
            </div>
          )}

          <div className="col">
            <label className="help">Room code</label>
            <input className="input" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="AB12CD" />
          </div>

          <div className="row homeJoinActions">
            <button className="btn" disabled={joining || !effectiveName.trim() || !joinCode.trim()} onClick={() => void joinRoom(false)}>
              {joining ? 'Joining...' : 'Join as player'}
            </button>
            <button className="btn" disabled={joining || !effectiveName.trim() || !joinCode.trim()} onClick={() => void joinRoom(true)}>
              {joining ? 'Joining...' : 'Join as spectator'}
            </button>
          </div>
        </div>
      </div>

      {err ? <div className="toast">{err}</div> : null}
    </div>
  )
}
