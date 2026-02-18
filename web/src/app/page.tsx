'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type { X01Settings } from '@/lib/types'

const defaultSettings: X01Settings = {
  gameType: 'X01',
  startScore: 501,
  legsToWin: 3,
  setsEnabled: false,
  setsToWin: 0,
  doubleIn: false,
  doubleOut: true,
  masterOut: false,
}

export default function HomePage() {
  const router = useRouter()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [hostSecret, setHostSecret] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [settings, setSettings] = useState<X01Settings>(defaultSettings)
  const [title, setTitle] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function createRoom() {
    setErr(null)
    setCreating(true)
    try {
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('room:create', { name, settings, title, isPublic })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to create room')
      localStorage.setItem('dc_name', name)
      localStorage.setItem('dc_hostSecret', res.hostSecret)
      localStorage.setItem('dc_role', res.role ?? 'PLAYER')
      setHostSecret(res.hostSecret)
      router.push(`/room/${res.code}/lobby`)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setCreating(false)
    }
  }

  async function joinRoom() {
    setErr(null)
    setJoining(true)
    try {
      const socket = getSocket(serverUrl)
      const code = joinCode.trim().toUpperCase()
      const res = await socket.emitWithAck('room:join', { code, name, asSpectator: false })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to join room')
      localStorage.setItem('dc_name', name)
      localStorage.setItem('dc_role', res.role ?? 'PLAYER')
      router.push(`/room/${code}/lobby`)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setJoining(false)
    }
  }

  async function joinRoomAsSpectator() {
    setErr(null)
    setJoining(true)
    try {
      const socket = getSocket(serverUrl)
      const code = joinCode.trim().toUpperCase()
      const res = await socket.emitWithAck('room:join', { code, name, asSpectator: true })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to join room')
      localStorage.setItem('dc_name', name)
      localStorage.setItem('dc_role', res.role ?? 'SPECTATOR')
      router.push(`/room/${code}/lobby`)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 className="title">Dartcounter Web</h1>
          <p className="subtitle">Create a room, invite friends, keep score in realtime.</p>
        </div>
        <span className="pill">Server: {serverUrl}</span>
      </div>

      <div className="grid2">
        <div className="card" style={{ padding: 16 }}>
          <div className="col">
            <div className="col">
              <label className="help">Your name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ruben" />
            </div>

            <hr className="hr" />

            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="help">Create room settings (locked on first turn)</div>
                {hostSecret ? <span className="pill">Host</span> : null}
              </div>

              <div className="grid2">
                <div className="col">
                  <label className="help">Lobby name</label>
                  <input
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Friday 501"
                  />
                </div>
                <div className="col">
                  <label className="help">Visibility</label>
                  <label className="pill" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                    Public lobby
                  </label>
                </div>
              </div>
      <div className="grid2">
                <div className="col">
                  <label className="help">Start score</label>
                  <input
                    className="input"
                    type="number"
                    value={settings.startScore}
                    onChange={(e) => setSettings((s) => ({ ...s, startScore: Number(e.target.value) }))}
                  />
                </div>
                <div className="col">
                  <label className="help">Legs to win</label>
                  <input
                    className="input"
                    type="number"
                    value={settings.legsToWin}
                    onChange={(e) => setSettings((s) => ({ ...s, legsToWin: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="grid2">
                <div className="col">
                  <label className="help">Sets</label>
                  <label className="pill" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settings.setsEnabled}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          setsEnabled: e.target.checked,
                          setsToWin: e.target.checked ? Math.max(1, s.setsToWin || 1) : 0,
                        }))
                      }
                    />
                    Enable sets
                  </label>
                </div>
                <div className="col">
                  <label className="help">Sets to win</label>
                  <input
                    className="input"
                    type="number"
                    value={settings.setsToWin}
                    disabled={!settings.setsEnabled}
                    onChange={(e) => setSettings((s) => ({ ...s, setsToWin: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="grid2">
                <div className="col">
                  <label className="help">In/Out</label>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <label className="pill" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={settings.doubleIn}
                        onChange={(e) => setSettings((s) => ({ ...s, doubleIn: e.target.checked }))}
                      />
                      Double-in
                    </label>
                    <label className="pill" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={settings.doubleOut}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            doubleOut: e.target.checked,
                            masterOut: e.target.checked ? false : s.masterOut,
                          }))
                        }
                      />
                      Double-out
                    </label>
                    <label className="pill" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={settings.masterOut}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            masterOut: e.target.checked,
                            doubleOut: e.target.checked ? false : s.doubleOut,
                          }))
                        }
                      />
                      Master-out
                    </label>
                  </div>
                </div>
                <div className="col">
                  <label className="help">Scoring input</label>
                  <div className="pill">Per-turn choice (total or darts)</div>
                </div>
              </div>
            </div>

            <button className="btn btnPrimary" disabled={creating || !name.trim()} onClick={createRoom}>
              {creating ? 'Creating...' : 'Create room'}
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="col">
            <div className="col">
              <label className="help">Your name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ruben" />
            </div>

            <div className="col">
              <label className="help">Room code</label>
              <input
                className="input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="AB12CD"
              />
            </div>
            <div className="row">
              <button className="btn" disabled={joining || !name.trim() || !joinCode.trim()} onClick={joinRoom}>
                {joining ? 'Joining...' : 'Join as player'}
              </button>
              <button className="btn" disabled={joining || !name.trim() || !joinCode.trim()} onClick={joinRoomAsSpectator}>
                {joining ? 'Joining...' : 'Join as spectator'}
              </button>
            </div>
            <div className="help">If you created the room on this device, your host secret is stored locally.</div>
          </div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <a className="btn" href="/lobbies">
          Browse public lobbies
        </a>
      </div>

      {err ? <div className="toast">{err}</div> : null}
    </div>
  )
}
