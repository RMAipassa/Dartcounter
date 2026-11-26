'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import { hostSecretForRoom, rememberHostSecret, rememberRoomIdentity, roomDeviceKey } from '@/lib/room-session'

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
    setName(authName || localStorage.getItem('dc_name') || '')
    if (authName) {
      setAuthDisplayName(authName)
    }
  }, [])

  const effectiveName = (authDisplayName || name).trim()

  async function joinRoom(asSpectator: boolean) {
    if (joining || !effectiveName || !joinCode.trim()) return
    setErr(null)
    setJoining(true)
    try {
      const socket = getSocket(serverUrl)
      const code = joinCode.trim().toUpperCase()
      const rawToken = localStorage.getItem('dc_authToken')
      const authToken = rawToken && rawToken.trim() ? rawToken.trim() : undefined
      const res = await socket.emitWithAck('room:join', {
        code,
        hostSecret: hostSecretForRoom(code) ?? undefined,
        deviceKey: roomDeviceKey(),
        name: effectiveName,
        authToken,
        asSpectator,
      })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to join room')
      localStorage.setItem('dc_name', effectiveName)
      if (res.hostSecret) rememberHostSecret(code, res.hostSecret)
      rememberRoomIdentity(code, effectiveName, res.role ?? (asSpectator ? 'SPECTATOR' : 'PLAYER'))
      router.push(`/room/${code}/lobby`)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setJoining(false)
    }
  }

  function joinAsPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void joinRoom(false)
  }

  return (
    <main className="col setupPage setupNarrow">
      <header className="row spread">
        <div>
          <span className="eyebrow">Play with friends</span>
          <h1 className="title">Join with a code</h1>
          <p className="subtitle">Enter the code from the host to play or watch.</p>
        </div>
      </header>

      <form className="card col setupPanel" onSubmit={joinAsPlayer}>
          {authDisplayName ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="help">Signed in name</div>
              <span className="pill" style={{ color: 'var(--text)' }}>{authDisplayName}</span>
            </div>
          ) : (
            <label className="col help">Your name
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" autoComplete="nickname" maxLength={32} required />
            </label>
          )}

          <label className="col help">Room code
            <input className="input setupCode" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="AB12CD" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={16} required />
          </label>

          {err ? <p className="formError" role="alert">{err}</p> : null}
          <div className="row setupFooter">
            <button type="submit" className="btn btnPrimary" disabled={joining || !effectiveName || !joinCode.trim()}>
              {joining ? 'Joining…' : 'Join as player'}
            </button>
            <button type="button" className="btn" disabled={joining || !effectiveName || !joinCode.trim()} onClick={() => void joinRoom(true)}>
              Join as spectator
            </button>
          </div>
      </form>
      <Link className="btn" href="/lobbies">Browse public lobbies</Link>
    </main>
  )
}
