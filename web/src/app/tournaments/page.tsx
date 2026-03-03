'use client'

import { useEffect, useMemo, useState } from 'react'
import { getServerUrl } from '@/lib/config'
import type { AroundSettings, X01Settings } from '@/lib/types'

type TournamentRow = {
  id: string
  name: string
  createdAt: number
  createdByDisplayName: string
  status: 'LOBBY' | 'LIVE' | 'FINISHED'
  format: 'SINGLE_ELIM'
  maxPlayers: number
  participationMode: 'ONLINE' | 'LOCAL'
  playersCount: number
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

  const [name, setName] = useState('Weekend Knockout')
  const [maxPlayers, setMaxPlayers] = useState('16')
  const [mode, setMode] = useState<'X01' | 'AROUND'>('X01')
  const [participationMode, setParticipationMode] = useState<'ONLINE' | 'LOCAL'>('ONLINE')
  const [startScore, setStartScore] = useState('501')
  const [legsToWin, setLegsToWin] = useState('3')
  const [setsEnabled, setSetsEnabled] = useState(false)
  const [setsToWin, setSetsToWin] = useState('1')

  useEffect(() => {
    void refreshList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl])

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

  async function createNew() {
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Sign in first to create a tournament')
      const normalizedLegs = Math.max(1, Math.min(99, Math.trunc(Number(legsToWin) || 3)))
      const normalizedSetsToWin = setsEnabled ? Math.max(1, Math.min(99, Math.trunc(Number(setsToWin) || 1))) : 0
      const settings =
        mode === 'X01'
          ? {
              ...defaultX01,
              startScore: Math.max(2, Math.min(10001, Math.trunc(Number(startScore) || 501))),
              legsToWin: normalizedLegs,
              setsEnabled,
              setsToWin: normalizedSetsToWin,
            }
          : {
              ...defaultAround,
              legsToWin: normalizedLegs,
              setsEnabled,
              setsToWin: normalizedSetsToWin,
            }
      const res = await fetch(`${serverUrl}/api/tournaments/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          maxPlayers: Math.max(2, Math.min(128, Math.trunc(Number(maxPlayers) || 16)), 2),
          participationMode,
          settings,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Create failed')
      await refreshList()
      const id = String(data.tournament?.id ?? '')
      if (id) window.location.href = `/tournaments/${encodeURIComponent(id)}`
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Tournaments</h1>
          <p className="subtitle">Create a tournament, then open its dedicated bracket page.</p>
        </div>
        <button className="btn" onClick={() => void refreshList()} disabled={busy}>
          Refresh
        </button>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Create tournament</div>
        <div className="grid2">
          <div className="col">
            <label className="help">Tournament name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend Knockout" />
          </div>
          <div className="col">
            <label className="help">Max players</label>
            <input className="input" type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} min={2} max={128} />
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 8 }}>
          {mode === 'X01' ? (
            <div className="col">
              <label className="help">Start score</label>
              <input className="input" type="number" min={2} max={10001} value={startScore} onChange={(e) => setStartScore(e.target.value)} />
            </div>
          ) : (
            <div className="col">
              <label className="help">Around mode</label>
              <span className="pill">Progression 1 to bull</span>
            </div>
          )}
          <div className="col">
            <label className="help">Legs to win</label>
            <input className="input" type="number" min={1} max={99} value={legsToWin} onChange={(e) => setLegsToWin(e.target.value)} />
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="col">
            <label className="help">Sets</label>
            <label className="pill" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={setsEnabled} onChange={(e) => setSetsEnabled(e.target.checked)} />
              Enable sets
            </label>
          </div>
          <div className="col">
            <label className="help">Sets to win</label>
            <input className="input" type="number" min={1} max={99} value={setsToWin} disabled={!setsEnabled} onChange={(e) => setSetsToWin(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <button className={participationMode === 'ONLINE' ? 'btn' : 'btn btnPrimary'} onClick={() => setParticipationMode('ONLINE')}>Online</button>
          <button className={participationMode === 'LOCAL' ? 'btn' : 'btn btnPrimary'} onClick={() => setParticipationMode('LOCAL')}>Local</button>
          <button className={mode === 'X01' ? 'btn' : 'btn btnPrimary'} onClick={() => setMode('X01')}>X01</button>
          <button className={mode === 'AROUND' ? 'btn' : 'btn btnPrimary'} onClick={() => setMode('AROUND')}>Around</button>
          <button className="btn btnPrimary" onClick={() => void createNew()} disabled={busy}>Create</button>
        </div>
        <div className="help" style={{ marginTop: 8 }}>
          {participationMode === 'ONLINE'
            ? 'Online mode: only real accounts can join, and you can invite friends.'
            : 'Local mode: host adds all players manually; online join/invites are disabled.'}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Open tournaments</div>
        <div className="col">
          {rows.length < 1 ? <span className="pill">No tournaments yet</span> : null}
          {rows.map((r) => (
            <a key={r.id} className="btn" href={`/tournaments/${encodeURIComponent(r.id)}`}>
              {r.name} · {r.participationMode} · {r.status} · {r.playersCount}/{r.maxPlayers}
            </a>
          ))}
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
