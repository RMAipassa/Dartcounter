'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type { RoomSnapshot, X01Settings } from '@/lib/types'

export default function LobbyPage() {
  const router = useRouter()
  const params = useParams<{ code: string }>()
  const code = (params.code ?? '').toUpperCase()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [snap, setSnap] = useState<RoomSnapshot | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [newPlayer, setNewPlayer] = useState('')
  const [startingPlayerIndex, setStartingPlayerIndex] = useState(0)
  const hostSecret = typeof window !== 'undefined' ? localStorage.getItem('dc_hostSecret') : null

  useEffect(() => {
    const socket = getSocket(serverUrl)
    let mounted = true

    socket.on('room:snapshot', (s: any) => {
      if (!mounted) return
      if (s?.code?.toUpperCase?.() !== code) return
      setSnap(s)

      const status = s?.match?.status
      if (status && status !== 'LOBBY') {
        router.replace(`/room/${code}/game`)
      }
      setStartingPlayerIndex((idx: number) => {
        const max = Math.max(0, (s?.match?.players?.length ?? 1) - 1)
        return Math.min(idx, max)
      })
    })

    socket.on('room:toast', (t: any) => {
      setToast(t?.message ?? 'Ok')
      setTimeout(() => setToast(null), 2500)
    })

    const name = localStorage.getItem('dc_name') ?? 'Guest'
    const role = localStorage.getItem('dc_role')
    socket
      .emitWithAck('room:join', {
        code,
        name,
        hostSecret: hostSecret ?? undefined,
        asSpectator: role === 'SPECTATOR',
      })
      .then((res: any) => {
      if (!res?.ok) setToast(res?.message ?? 'Failed to join')
      if (res?.ok && res?.role === 'PLAYER' && res?.playerId) {
        const key = `dc_controlled_${code}`
        const current = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
        if (!current.includes(res.playerId)) {
          current.push(res.playerId)
          localStorage.setItem(key, JSON.stringify(current))
        }
      }
      })

    return () => {
      mounted = false
      socket.off('room:snapshot')
      socket.off('room:toast')
    }
  }, [code, hostSecret, serverUrl])

  const isHost = useMemo(() => {
    // best-effort: if we have a host secret, treat as host; server enforces anyway
    return Boolean(hostSecret)
  }, [hostSecret])

  async function addPlayer() {
    try {
      if (!hostSecret) throw new Error('Host secret not found on this device')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('lobby:addPlayer', { hostSecret, name: newPlayer })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')

      // Host controls players they add until the player joins.
      const key = `dc_controlled_${code}`
      const current = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
      if (res?.player?.id && !current.includes(res.player.id)) {
        current.push(res.player.id)
        localStorage.setItem(key, JSON.stringify(current))
      }

      setNewPlayer('')
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  async function updateSettings(settings: X01Settings) {
    try {
      if (!hostSecret) throw new Error('Host secret not found on this device')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('lobby:updateSettings', { hostSecret, settings })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  async function startGame() {
    try {
      if (!hostSecret) throw new Error('Host secret not found on this device')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('lobby:startGame', { hostSecret, startingPlayerIndex })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to start')
      router.push(`/room/${code}/game`)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  const match = snap?.match
  const players = match?.players ?? []
  const settings = match?.settings
  const locked = Boolean(match?.lockedAt)
  const myName = typeof window !== 'undefined' ? (localStorage.getItem('dc_name') ?? '') : ''
  const iAmPlayer = myName ? players.some((p) => p.name.toLowerCase() === myName.toLowerCase()) : false
  const spectators = (snap?.clients ?? [])
    .filter((c) => c.role === 'SPECTATOR')
    .map((c) => c.name)
    .filter((n, idx, arr) => arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === idx)

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Lobby</h1>
          <p className="subtitle">
            Room <span className="pill">{code}</span> {locked ? <span className="pill">Settings locked</span> : null}
          </p>
        </div>
        <div className="row">
          <a className="btn" href="/">
            Home
          </a>
        </div>
      </div>

      <div className="grid2">
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, marginBottom: 6 }}>Players</div>
              <div className="help">Add players, then choose who starts.</div>
            </div>
            {isHost ? <span className="pill">Host controls</span> : <span className="pill">Viewer</span>}
          </div>

          <div className="col" style={{ marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="pill">You are: {iAmPlayer ? 'Player' : 'Spectator'}</span>
              <div className="row">
                <button
                  className="btn"
                  disabled={locked || match?.status !== 'LOBBY' || iAmPlayer}
                  onClick={async () => {
                    const socket = getSocket(serverUrl)
                    const res = await socket.emitWithAck('lobby:becomePlayer')
                    if (!res?.ok) setToast(res?.message ?? 'Failed')
                    else localStorage.setItem('dc_role', 'PLAYER')
                  }}
                >
                  Switch to player
                </button>
                <button
                  className="btn"
                  disabled={locked || match?.status !== 'LOBBY' || !iAmPlayer}
                  onClick={async () => {
                    const socket = getSocket(serverUrl)
                    const res = await socket.emitWithAck('lobby:becomeSpectator')
                    if (!res?.ok) setToast(res?.message ?? 'Failed')
                    else localStorage.setItem('dc_role', 'SPECTATOR')
                  }}
                >
                  Switch to spectator
                </button>
              </div>
            </div>

            <div className="row" style={{ flexWrap: 'wrap' }}>
              {players.length === 0 ? <span className="help">No players yet.</span> : null}
              {players.map((p) => (
                <span key={p.id} className="pill">
                  {p.name}
                </span>
              ))}
            </div>

            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="help">Spectators:</span>
              {spectators.length === 0 ? <span className="help">none</span> : null}
              {spectators.map((n) => (
                <span key={n} className="pill">
                  {n}
                </span>
              ))}
            </div>

            <hr className="hr" />

            <div className="row">
              <input
                className="input"
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
                placeholder="Add player name"
                disabled={!isHost || locked || match?.status !== 'LOBBY'}
              />
              <button
                className="btn"
                onClick={addPlayer}
                disabled={!isHost || locked || !newPlayer.trim() || match?.status !== 'LOBBY'}
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 6 }}>Lobby</div>
          <div className="help">Visibility + settings lock after the first recorded turn.</div>

          <div className="col" style={{ marginTop: 10 }}>
            <div className="grid2">
              <div className="col">
                <label className="help">Lobby name</label>
                <LobbyNameEditor
                  initialValue={snap?.room?.title ?? ''}
                  disabled={!isHost || locked || match?.status !== 'LOBBY'}
                  onSave={async (val) => {
                    if (!hostSecret) return
                    const socket = getSocket(serverUrl)
                    const res = await socket.emitWithAck('lobby:updateRoomMeta', {
                      hostSecret,
                      title: val,
                    })
                    if (!res?.ok) setToast(res?.message ?? 'Failed')
                  }}
                />
              </div>
              <div className="col">
                <label className="help">Visibility</label>
                <label className="pill" style={{ cursor: !isHost || locked || match?.status !== 'LOBBY' ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(snap?.room?.isPublic)}
                    disabled={!isHost || locked || match?.status !== 'LOBBY'}
                    onChange={async (e) => {
                      if (!hostSecret) return
                      const socket = getSocket(serverUrl)
                      const res = await socket.emitWithAck('lobby:updateRoomMeta', {
                        hostSecret,
                        isPublic: e.target.checked,
                      })
                      if (!res?.ok) setToast(res?.message ?? 'Failed')
                    }}
                  />
                  Public lobby
                </label>
              </div>
            </div>
          </div>

          <hr className="hr" style={{ marginTop: 14 }} />

          <div style={{ fontSize: 16, marginBottom: 6 }}>Settings</div>
          {settings ? (
            <LobbySettings settings={settings} locked={locked || match?.status !== 'LOBBY'} onChange={updateSettings} />
          ) : (
            <div className="help" style={{ marginTop: 10 }}>
              Waiting for snapshot...
            </div>
          )}

          <hr className="hr" style={{ marginTop: 14 }} />

          <div className="col">
            <div className="help">Starting player</div>
            <select
              className="select"
              value={startingPlayerIndex}
              onChange={(e) => setStartingPlayerIndex(Number(e.target.value))}
              disabled={!isHost || match?.status !== 'LOBBY' || players.length === 0}
            >
              {players.map((p, idx) => (
                <option key={p.id} value={idx}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn btnPrimary"
              onClick={startGame}
              disabled={!isHost || match?.status !== 'LOBBY' || players.length === 0}
            >
              Start game
            </button>
          </div>
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

function LobbySettings({
  settings,
  locked,
  onChange,
}: {
  settings: X01Settings
  locked: boolean
  onChange: (s: X01Settings) => void
}) {
  const [draft, setDraft] = useState<X01Settings>(settings)
  useEffect(() => setDraft(settings), [settings])

  const invalid = draft.doubleOut && draft.masterOut
  return (
    <div className="col" style={{ marginTop: 10 }}>
      <div className="grid2">
        <div className="col">
          <label className="help">Start score</label>
          <input
            className="input"
            type="number"
            value={draft.startScore}
            onChange={(e) => setDraft((s) => ({ ...s, startScore: Number(e.target.value) }))}
            disabled={locked}
          />
        </div>
        <div className="col">
          <label className="help">Legs to win</label>
          <input
            className="input"
            type="number"
            value={draft.legsToWin}
            onChange={(e) => setDraft((s) => ({ ...s, legsToWin: Number(e.target.value) }))}
            disabled={locked}
          />
        </div>
      </div>

      <div className="grid2">
        <div className="col">
          <label className="help">Sets</label>
          <label className="pill" style={{ cursor: locked ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.setsEnabled}
              disabled={locked}
              onChange={(e) =>
                setDraft((s) => ({
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
            value={draft.setsToWin}
            disabled={locked || !draft.setsEnabled}
            onChange={(e) => setDraft((s) => ({ ...s, setsToWin: Number(e.target.value) }))}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="col">
          <label className="help">Input mode</label>
          <div className="pill">Per-turn (total or darts)</div>
        </div>
        <div className="col">
          <label className="help">In</label>
          <label className="pill" style={{ cursor: locked ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.doubleIn}
              disabled={locked}
              onChange={(e) => setDraft((s) => ({ ...s, doubleIn: e.target.checked }))}
            />
            Double-in
          </label>
        </div>
      </div>

      <div className="col">
        <label className="help">Out</label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="pill" style={{ cursor: locked ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.doubleOut}
              disabled={locked}
              onChange={(e) =>
                setDraft((s) => ({
                  ...s,
                  doubleOut: e.target.checked,
                  masterOut: e.target.checked ? false : s.masterOut,
                }))
              }
            />
            Double-out
          </label>
          <label className="pill" style={{ cursor: locked ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.masterOut}
              disabled={locked}
              onChange={(e) =>
                setDraft((s) => ({
                  ...s,
                  masterOut: e.target.checked,
                  doubleOut: e.target.checked ? false : s.doubleOut,
                }))
              }
            />
            Master-out
          </label>
        </div>
        {invalid ? <div className="help" style={{ color: 'var(--bad)' }}>
          Double-out and Master-out can’t both be enabled.
        </div> : null}
      </div>

      <button className="btn" disabled={locked || invalid} onClick={() => onChange(draft)}>
        Save settings
      </button>
    </div>
  )
}

function LobbyNameEditor({
  initialValue,
  disabled,
  onSave,
}: {
  initialValue: string
  disabled: boolean
  onSave: (val: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  useEffect(() => setValue(initialValue), [initialValue])

  return (
    <input
      className="input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (disabled) return
        onSave(value)
      }}
      disabled={disabled}
      placeholder="Untitled lobby"
    />
  )
}
