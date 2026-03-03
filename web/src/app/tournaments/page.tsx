'use client'

import { useEffect, useMemo, useState } from 'react'
import { getServerUrl } from '@/lib/config'
import type { AroundSettings, Tournament, X01Settings } from '@/lib/types'

type TournamentRow = {
  id: string
  name: string
  createdAt: number
  createdByDisplayName: string
  status: 'LOBBY' | 'LIVE' | 'FINISHED'
  format: 'SINGLE_ELIM'
  playersCount: number
  maxPlayers: number
  isHost: boolean
  isParticipant: boolean
  winnerUserId: string | null
}

const defaultX01: X01Settings = {
  gameType: 'X01',
  startScore: 501,
  legsToWin: 3,
  setsEnabled: false,
  setsToWin: 0,
  doubleIn: false,
  doubleOut: true,
  masterOut: false,
}

const defaultAround: AroundSettings = {
  gameType: 'AROUND',
  legsToWin: 3,
  setsEnabled: false,
  setsToWin: 0,
  advanceByMultiplier: false,
}

export default function TournamentsPage() {
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [rows, setRows] = useState<TournamentRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Tournament | null>(null)

  const [name, setName] = useState('Weekend Knockout')
  const [maxPlayers, setMaxPlayers] = useState('16')
  const [mode, setMode] = useState<'X01' | 'AROUND'>('X01')

  useEffect(() => {
    void refreshList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl])

  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      return
    }
    void refreshSelected(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function refreshList() {
    try {
      const token = localStorage.getItem('dc_authToken')
      const res = await fetch(`${serverUrl}/api/tournaments`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Failed to load tournaments')
      setRows(Array.isArray(data.tournaments) ? (data.tournaments as TournamentRow[]) : [])
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  async function refreshSelected(id: string) {
    try {
      const token = localStorage.getItem('dc_authToken')
      const res = await fetch(`${serverUrl}/api/tournaments/${encodeURIComponent(id)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Failed to load tournament')
      setSelected(data.tournament as Tournament)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  async function createNew() {
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Sign in first to create a tournament')
      const settings = mode === 'X01' ? defaultX01 : defaultAround
      const res = await fetch(`${serverUrl}/api/tournaments/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          maxPlayers: Math.max(2, Math.min(128, Math.trunc(Number(maxPlayers) || 16)), 2),
          settings,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Create failed')
      await refreshList()
      const id = String(data.tournament?.id ?? '')
      if (id) setSelectedId(id)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doAction(path: string, body: any) {
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Sign in first')
      const res = await fetch(`${serverUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Action failed')
      if (selectedId) await refreshSelected(selectedId)
      await refreshList()
      return data
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function assignRoom(matchId: string) {
    const roomCode = window.prompt('Room code for this match (existing room):', '')?.trim().toUpperCase()
    if (!roomCode || !selected) return
    await doAction('/api/tournaments/match/room', { tournamentId: selected.id, matchId, roomCode })
  }

  function displayNameForUser(userId: string | null): string {
    if (!userId || !selected) return '-'
    return selected.players.find((p) => p.userId === userId)?.displayName ?? userId.slice(0, 8)
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Tournaments</h1>
          <p className="subtitle">Single-elimination MVP. Join, start bracket, assign room codes, report winners.</p>
        </div>
        <button className="btn" onClick={() => void refreshList()} disabled={busy}>
          Refresh
        </button>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Create tournament</div>
        <div className="grid2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tournament name" />
          <input className="input" type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} min={2} max={128} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className={mode === 'X01' ? 'btn btnPrimary' : 'btn'} onClick={() => setMode('X01')}>
            X01
          </button>
          <button className={mode === 'AROUND' ? 'btn btnPrimary' : 'btn'} onClick={() => setMode('AROUND')}>
            Around
          </button>
          <button className="btn btnPrimary" onClick={() => void createNew()} disabled={busy}>
            Create
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Open tournaments</div>
          <div className="col">
            {rows.length < 1 ? <span className="pill">No tournaments yet</span> : null}
            {rows.map((r) => (
              <button key={r.id} className={selectedId === r.id ? 'btn btnPrimary' : 'btn'} onClick={() => setSelectedId(r.id)}>
                {r.name} · {r.status} · {r.playersCount}/{r.maxPlayers}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          {!selected ? <span className="pill">Select a tournament</span> : null}
          {selected ? (
            <div className="col" style={{ gap: 10 }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className="pill" style={{ color: 'var(--text)' }}>{selected.name}</span>
                <span className="pill">{selected.status}</span>
                <span className="pill">{selected.players.length}/{selected.maxPlayers}</span>
                <span className="pill">Host: {selected.createdByDisplayName}</span>
              </div>

              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy || selected.status !== 'LOBBY'} onClick={() => void doAction('/api/tournaments/join', { tournamentId: selected.id })}>
                  Join
                </button>
                <button className="btn" disabled={busy || selected.status !== 'LOBBY'} onClick={() => void doAction('/api/tournaments/leave', { tournamentId: selected.id })}>
                  Leave
                </button>
                <button className="btn btnPrimary" disabled={busy || !selected.isHost || selected.status !== 'LOBBY'} onClick={() => void doAction('/api/tournaments/start', { tournamentId: selected.id })}>
                  Start bracket
                </button>
              </div>

              <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
                <div className="help" style={{ marginBottom: 8 }}>Players</div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {selected.players.map((p) => (
                    <span key={p.userId} className="pill">{p.displayName}</span>
                  ))}
                </div>
              </div>

              {selected.rounds.map((round) => (
                <div key={round.roundIndex} className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
                  <div className="help" style={{ marginBottom: 8 }}>Round {round.roundIndex + 1}</div>
                  <div className="col">
                    {round.matches.map((m) => (
                      <div key={m.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <span className="pill">M{m.matchIndex + 1}</span>
                        <span className="pill">{displayNameForUser(m.playerAUserId)} vs {displayNameForUser(m.playerBUserId)}</span>
                        <span className="pill">{m.status}</span>
                        <span className="pill">Winner: {displayNameForUser(m.winnerUserId)}</span>
                        {m.roomCode ? <a className="btn" href={`/room/${m.roomCode}/lobby`}>Room {m.roomCode}</a> : null}
                        {selected.isHost && selected.status === 'LIVE' && m.playerAUserId && m.playerBUserId && !m.winnerUserId ? (
                          <>
                            <button className="btn" onClick={() => void assignRoom(m.id)} disabled={busy}>
                              Set room
                            </button>
                            <button className="btn" onClick={() => void doAction('/api/tournaments/match/report', { tournamentId: selected.id, matchId: m.id, winnerUserId: m.playerAUserId })} disabled={busy}>
                              A wins
                            </button>
                            <button className="btn" onClick={() => void doAction('/api/tournaments/match/report', { tournamentId: selected.id, matchId: m.id, winnerUserId: m.playerBUserId })} disabled={busy}>
                              B wins
                            </button>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
