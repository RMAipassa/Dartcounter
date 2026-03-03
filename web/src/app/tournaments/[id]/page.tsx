'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type { Tournament, TournamentInvite } from '@/lib/types'

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>()
  const tournamentId = String(params?.id ?? '')
  const serverUrl = useMemo(() => getServerUrl(), [])

  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [t, setTournament] = useState<Tournament | null>(null)
  const [friends, setFriends] = useState<Array<{ userId: string; displayName: string }>>([])
  const [pendingInvites, setPendingInvites] = useState<TournamentInvite[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [seedingMode, setSeedingMode] = useState<'JOIN_ORDER' | 'RANDOM' | 'MANUAL'>('JOIN_ORDER')
  const [manualSeedIds, setManualSeedIds] = useState<string[]>([])
  const [localPlayerName, setLocalPlayerName] = useState('')

  useEffect(() => {
    if (!tournamentId) return
    void refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, serverUrl])

  useEffect(() => {
    if (!t) return
    setSeedingMode(t.seedingMode ?? 'JOIN_ORDER')
    const fallback = t.players.map((p) => p.userId)
    const incoming = Array.isArray(t.manualSeedUserIds) ? t.manualSeedUserIds : fallback
    const ordered = [...incoming]
    for (const id of fallback) if (!ordered.includes(id)) ordered.push(id)
    setManualSeedIds(ordered)
  }, [t])

  async function refreshAll() {
    await Promise.all([refreshTournament(), refreshFriends(), refreshInvites(), refreshMe()])
  }

  async function refreshMe() {
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) return setIsAdmin(false)
      const res = await fetch(`${serverUrl}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) return setIsAdmin(false)
      setIsAdmin(Boolean(data.isAdmin))
    } catch {
      setIsAdmin(false)
    }
  }

  async function refreshTournament() {
    try {
      const token = localStorage.getItem('dc_authToken')
      const res = await fetch(`${serverUrl}/api/tournaments/${encodeURIComponent(tournamentId)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Failed to load tournament')
      setTournament(data.tournament as Tournament)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  async function refreshFriends() {
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) return setFriends([])
      const res = await fetch(`${serverUrl}/api/friends/me`, { headers: { authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) return setFriends([])
      setFriends(
        Array.isArray(data.friends)
          ? data.friends
              .map((f: any) => ({ userId: String(f.user?.userId ?? ''), displayName: String(f.user?.displayName ?? '') }))
              .filter((f: any) => f.userId)
          : [],
      )
    } catch {
      setFriends([])
    }
  }

  async function refreshInvites() {
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) return setPendingInvites([])
      const res = await fetch(`${serverUrl}/api/tournaments/invites/me`, { headers: { authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) return setPendingInvites([])
      setPendingInvites(Array.isArray(data.invites) ? (data.invites as TournamentInvite[]) : [])
    } catch {
      setPendingInvites([])
    }
  }

  async function doAction(path: string, body: any) {
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Sign in first')
      const res = await fetch(`${serverUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Action failed')
      await refreshAll()
      return data
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  function displayNameForUser(userId: string | null): string {
    if (!userId || !t) return '-'
    return t.players.find((p) => p.userId === userId)?.displayName ?? userId.slice(0, 8)
  }

  function moveSeed(userId: string, direction: -1 | 1) {
    setManualSeedIds((ids) => {
      const idx = ids.indexOf(userId)
      if (idx < 0) return ids
      const target = idx + direction
      if (target < 0 || target >= ids.length) return ids
      const out = [...ids]
      const tmp = out[idx]
      out[idx] = out[target]
      out[target] = tmp
      return out
    })
  }

  async function saveSeeding(nextMode?: 'JOIN_ORDER' | 'RANDOM' | 'MANUAL') {
    if (!t) return
    const modeToSave = nextMode ?? seedingMode
    setSeedingMode(modeToSave)
    await doAction('/api/tournaments/seeding', {
      tournamentId: t.id,
      mode: modeToSave,
      manualSeedUserIds: modeToSave === 'MANUAL' ? manualSeedIds : undefined,
    })
  }

  async function createRoomForMatch(matchId: string) {
    if (!t) return
    try {
      const token = localStorage.getItem('dc_authToken') ?? undefined
      const fallbackName = localStorage.getItem('dc_authDisplayName') ?? localStorage.getItem('dc_name') ?? 'Player'
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('room:create', {
        name: fallbackName,
        authToken: token,
        settings: t.settings,
        title: `${t.name} • Match`,
        isPublic: false,
        tournamentId: t.id,
        tournamentMatchId: matchId,
      })
      if (!res?.ok) throw new Error(res?.message ?? 'Could not create room')
      window.location.href = `/room/${res.code}/lobby`
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  async function inviteFriend(friendUserId: string) {
    if (!t) return
    await doAction('/api/tournaments/invite', { tournamentId: t.id, toUserId: friendUserId })
  }

  async function respondInvite(inviteId: string, accept: boolean) {
    await doAction('/api/tournaments/invite/respond', { inviteId, accept })
  }

  function copyShareLink() {
    if (!t) return
    const url = `${window.location.origin}/tournaments/${encodeURIComponent(t.id)}`
    void navigator.clipboard.writeText(url)
    setToast('Share link copied')
    setTimeout(() => setToast(null), 1400)
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <h1 className="title">Tournament</h1>
          <p className="subtitle">Dedicated bracket page</p>
        </div>
        <div className="row">
          <a className="btn" href="/tournaments">Back</a>
          <button className="btn" onClick={() => void refreshAll()} disabled={busy}>Refresh</button>
        </div>
      </div>

      {pendingInvites.length > 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Tournament invites</div>
          <div className="col">
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill" style={{ color: 'var(--text)' }}>{inv.tournamentName}</span>
                <span className="pill">From: {inv.fromDisplayName}</span>
                <button className="btn" disabled={busy} onClick={() => void respondInvite(inv.id, true)}>Accept</button>
                <button className="btn" disabled={busy} onClick={() => void respondInvite(inv.id, false)}>Decline</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!t ? <div className="card" style={{ padding: 16 }}><span className="pill">Loading tournament...</span></div> : null}
      {t ? (
        <>
          <div className="card" style={{ padding: 16 }}>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill" style={{ color: 'var(--text)' }}>{t.name}</span>
              <span className="pill">{t.participationMode}</span>
              <span className="pill">{t.status}</span>
              <span className="pill">{t.players.length}/{t.maxPlayers}</span>
              <span className="pill">Host: {t.createdByDisplayName}</span>
              <button className="btn" onClick={copyShareLink}>Copy share link</button>
            </div>
            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              {t.participationMode === 'ONLINE' ? (
                <button className="btn" disabled={busy || t.status !== 'LOBBY'} onClick={() => void doAction('/api/tournaments/join', { tournamentId: t.id })}>Join</button>
              ) : null}
              <button className="btn" disabled={busy || t.status !== 'LOBBY'} onClick={() => void doAction('/api/tournaments/leave', { tournamentId: t.id })}>Leave</button>
              <button className="btn btnPrimary" disabled={busy || !t.isHost || t.status !== 'LOBBY'} onClick={() => void doAction('/api/tournaments/start', { tournamentId: t.id })}>Start bracket</button>
              {isAdmin && t.participationMode === 'LOCAL' && t.status !== 'FINISHED' ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void doAction('/api/tournaments/close', { tournamentId: t.id })}
                >
                  Admin close
                </button>
              ) : null}
            </div>
          </div>

          <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
            <div className="help" style={{ marginBottom: 8 }}>Players</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {t.players.map((p) => (
                <span key={p.userId} className="pill">{p.displayName}{p.source === 'LOCAL' ? ' (Local)' : ''}</span>
              ))}
            </div>
          </div>

          {t.isHost && t.status === 'LOBBY' && t.participationMode === 'LOCAL' ? (
            <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
              <div className="help" style={{ marginBottom: 8 }}>Add local player</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <input className="input" value={localPlayerName} onChange={(e) => setLocalPlayerName(e.target.value)} placeholder="Player name" />
                <button
                  className="btn"
                  disabled={busy || !localPlayerName.trim()}
                  onClick={async () => {
                    if (!localPlayerName.trim()) return
                    const ok = await doAction('/api/tournaments/player/add', { tournamentId: t.id, displayName: localPlayerName.trim() })
                    if (ok) setLocalPlayerName('')
                  }}
                >
                  Add local
                </button>
              </div>
            </div>
          ) : null}

          {t.isHost && t.status === 'LOBBY' ? (
            <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
              <div className="help" style={{ marginBottom: 8 }}>Seeding</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className={seedingMode === 'JOIN_ORDER' ? 'btn btnPrimary' : 'btn'} onClick={() => void saveSeeding('JOIN_ORDER')} disabled={busy}>Join order</button>
                <button className={seedingMode === 'RANDOM' ? 'btn btnPrimary' : 'btn'} onClick={() => void saveSeeding('RANDOM')} disabled={busy}>Random</button>
                <button className={seedingMode === 'MANUAL' ? 'btn btnPrimary' : 'btn'} onClick={() => void saveSeeding('MANUAL')} disabled={busy}>Manual</button>
              </div>
              {seedingMode === 'MANUAL' ? (
                <div className="col" style={{ marginTop: 8 }}>
                  {manualSeedIds.map((id, idx) => (
                    <div key={id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <span className="pill">{idx + 1}. {displayNameForUser(id)}</span>
                      <div className="row">
                        <button className="btn" onClick={() => moveSeed(id, -1)} disabled={busy}>Up</button>
                        <button className="btn" onClick={() => moveSeed(id, 1)} disabled={busy}>Down</button>
                      </div>
                    </div>
                  ))}
                  <button className="btn btnPrimary" onClick={() => void saveSeeding('MANUAL')} disabled={busy}>Save manual seeding</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {t.status === 'LOBBY' && t.isParticipant && t.participationMode === 'ONLINE' ? (
            <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
              <div className="help" style={{ marginBottom: 8 }}>Invite friends</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {friends.length < 1 ? <span className="pill">No friends yet</span> : null}
                {friends
                  .filter((f) => !t.players.some((p) => p.userId === f.userId))
                  .map((f) => (
                    <button key={f.userId} className="btn" onClick={() => void inviteFriend(f.userId)} disabled={busy}>Invite {f.displayName}</button>
                  ))}
              </div>
            </div>
          ) : null}

          {t.isHost && t.status === 'LIVE' ? (
            <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
              <div className="help" style={{ marginBottom: 8 }}>Match controls</div>
              <div className="col" style={{ gap: 8 }}>
                {t.rounds.flatMap((round) => round.matches).filter((m) => m.playerAUserId && m.playerBUserId && !m.winnerUserId).length < 1 ? (
                  <span className="pill">No active matches to manage</span>
                ) : null}
                {t.rounds.flatMap((round) => round.matches).filter((m) => m.playerAUserId && m.playerBUserId && !m.winnerUserId).map((m) => (
                  <div key={`ctrl-${m.id}`} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span className="pill">R{m.roundIndex + 1} M{m.matchIndex + 1}</span>
                    <span className="pill">{displayNameForUser(m.playerAUserId)} vs {displayNameForUser(m.playerBUserId)}</span>
                    {!m.roomCode ? <button className="btn" onClick={() => void createRoomForMatch(m.id)} disabled={busy}>Create room</button> : null}
                    <button className="btn" onClick={async () => {
                      const roomCode = window.prompt('Room code for this match (existing room):', '')?.trim().toUpperCase()
                      if (!roomCode) return
                      await doAction('/api/tournaments/match/room', { tournamentId: t.id, matchId: m.id, roomCode })
                    }} disabled={busy}>Set room</button>
                    <button className="btn" onClick={() => void doAction('/api/tournaments/match/report', { tournamentId: t.id, matchId: m.id, winnerUserId: m.playerAUserId })} disabled={busy}>A wins</button>
                    <button className="btn" onClick={() => void doAction('/api/tournaments/match/report', { tournamentId: t.id, matchId: m.id, winnerUserId: m.playerBUserId })} disabled={busy}>B wins</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="card" style={{ padding: 12 }}>
            <div className="help" style={{ marginBottom: 8 }}>Bracket</div>
            <div className="tourneyBracketBoard">
              {t.rounds.map((round) => {
                const firstRoundMatches = Math.max(1, t.rounds[0]?.matches.length ?? 1)
                const rowStep = 136
                const unitRows = firstRoundMatches * 2
                const trackHeight = unitRows * rowStep
                return (
                <div key={round.roundIndex} className="tourneyRoundTrack" style={{ minWidth: 300 }}>
                  <span className="pill">Round {round.roundIndex + 1}</span>
                  <div className="tourneyRoundLane" style={{ height: trackHeight, marginTop: 18 }}>
                  {round.matches.map((m) => {
                    const centerUnit = 2 ** round.roundIndex + m.matchIndex * 2 ** (round.roundIndex + 1)
                    const top = centerUnit * rowStep
                    const halfSpan = 2 ** round.roundIndex * rowStep
                    const nodeStyle: CSSProperties = {
                      top,
                      ['--branch-span' as any]: `${halfSpan}px`,
                    }
                    return (
                    <div key={m.id} className="tourneyMatchAbs" style={nodeStyle}>
                    <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)', minHeight: 136 }}>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className="pill">M{m.matchIndex + 1}</span>
                        <span className="pill">{m.status}</span>
                      </div>
                      <div className="col" style={{ gap: 6 }}>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span className="pill" style={{ color: m.winnerUserId === m.playerAUserId ? 'var(--good)' : 'var(--text)' }}>{displayNameForUser(m.playerAUserId)}</span>
                        </div>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span className="pill" style={{ color: m.winnerUserId === m.playerBUserId ? 'var(--good)' : 'var(--text)' }}>{displayNameForUser(m.playerBUserId)}</span>
                        </div>
                        <span className="pill">Winner: {displayNameForUser(m.winnerUserId)}</span>
                        {m.roomCode ? <a className="btn" href={`/room/${m.roomCode}/lobby`}>Room {m.roomCode}</a> : null}
                      </div>
                    </div>
                    {round.roundIndex < t.rounds.length - 1 ? <span className="tourneyLine tourneyLineH" aria-hidden="true" /> : null}
                    {round.roundIndex < t.rounds.length - 1 && round.matches.length > 1 && m.matchIndex % 2 === 0 ? (
                      <span className="tourneyLine tourneyLineVDown" aria-hidden="true" />
                    ) : null}
                    {round.roundIndex < t.rounds.length - 1 && round.matches.length > 1 && m.matchIndex % 2 === 1 ? (
                      <span className="tourneyLine tourneyLineVUp" aria-hidden="true" />
                    ) : null}
                    </div>
                  )})}
                  </div>
                </div>
              )})}
            </div>
          </div>
        </>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
