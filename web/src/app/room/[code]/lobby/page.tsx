'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import NameRow from '@/components/NameRow'
import { SectionPanel, SectionTabs } from '@/components/SectionTabs'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import { hostSecretForRoom, rememberActiveMatch, rememberRoomIdentity, subscribeToRoom } from '@/lib/room-session'
import type { GameSettings, PracticeSettings, RoomSnapshot } from '@/lib/types'

const allowedX01StartScores = [121, 170, 301, 501] as const
const lobbyTabs = [
  { id: 'players', label: 'Players' }, { id: 'rules', label: 'Rules' },
  { id: 'room', label: 'Room' }, { id: 'board', label: 'Board' },
] as const

type LobbyFriend = {
  user: { userId: string; displayName: string; email: string }
  online: boolean
}

export default function LobbyPage() {
  const router = useRouter()
  const params = useParams<{ code: string }>()
  const code = (params.code ?? '').toUpperCase()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [snap, setSnap] = useState<RoomSnapshot | null>(null)
  const [socketId, setSocketId] = useState<string>()
  const [section, setSection] = useState<(typeof lobbyTabs)[number]['id']>('players')
  const [toast, setToast] = useState<string | null>(null)
  const [newPlayer, setNewPlayer] = useState('')
  const [startingPlayerIndex, setStartingPlayerIndex] = useState(0)
  const [friends, setFriends] = useState<LobbyFriend[]>([])
  const hostSecret = typeof window !== 'undefined' ? hostSecretForRoom(code) : null

  useEffect(() => {
    const socket = getSocket(serverUrl)
    let mounted = true

    socket.on('room:snapshot', (s: any) => {
      if (!mounted) return
      if (s?.code?.toUpperCase?.() !== code) return
      rememberActiveMatch(s)
      setSnap(s)

      const status = s?.match?.status
      if (status === 'LIVE') {
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

    const stop = subscribeToRoom(socket, code, (connected) => setSocketId(connected ? socket.id : undefined), setToast)

    return () => {
      mounted = false
      stop()
      socket.off('room:snapshot')
      socket.off('room:toast')
    }
  }, [code, router, serverUrl])

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
    if (!token) {
      setFriends([])
      return
    }

    const load = async () => {
      const res = await fetch(`${serverUrl}/api/friends/me`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        setFriends([])
        return
      }
      setFriends(Array.isArray(data.friends) ? data.friends : [])
    }

    void load()
    const t = window.setInterval(() => void load(), 12000)
    return () => window.clearInterval(t)
  }, [serverUrl])

  async function addPlayer() {
    try {
      if (!hostSecret) throw new Error('Host secret not found on this device')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('lobby:addPlayer', { hostSecret, name: newPlayer })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')

      setNewPlayer('')
    } catch (e: any) {
      setToast(e?.message ?? String(e))
    }
  }

  async function updateSettings(settings: GameSettings) {
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

  async function inviteFriend(friendUserId: string) {
    try {
      const authToken = localStorage.getItem('dc_authToken') ?? undefined
      if (!authToken) throw new Error('Sign in to invite friends')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('room:inviteFriend', { friendUserId, authToken })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to send invite')
      if (Number(res?.delivered ?? 0) > 0) setToast('Invite sent')
      else setToast('Friend is offline, invite not delivered')
      setTimeout(() => setToast(null), 1800)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2200)
    }
  }

  const match = snap?.match
  const players = match?.players ?? []
  const settings = match?.settings
  const locked = Boolean(match?.lockedAt)
  const inLobby = match?.status === 'LOBBY'
  const ownClient = snap?.clients.find((client) => client.socketId === socketId)
  const isHost = Boolean(ownClient?.isHost && hostSecret)
  const canEdit = isHost && inLobby && !locked
  const autodarts = snap?.room?.autodarts
  const autodartsActiveUserId = snap?.room?.autodartsActiveUserId ?? null
  const autodartsActiveClient = autodartsActiveUserId
    ? (snap?.clients ?? []).find((c) => c.userId === autodartsActiveUserId)
    : null
  const iAmPlayer = ownClient?.role === 'PLAYER'
  const spectators = (snap?.clients ?? [])
    .filter((c) => c.role === 'SPECTATOR')
    .map((c) => c.name)
    .filter((n, idx, arr) => arr.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === idx)

  async function changeRole() {
    const res = await getSocket(serverUrl).emitWithAck(iAmPlayer ? 'lobby:becomeSpectator' : 'lobby:becomePlayer')
    if (!res?.ok) setToast(res?.message ?? 'Could not switch roles')
    else if (ownClient) rememberRoomIdentity(code, ownClient.name, iAmPlayer ? 'SPECTATOR' : 'PLAYER')
  }

  async function updateRoomMeta(patch: { title?: string; isPublic?: boolean }) {
    if (!canEdit) return
    const res = await getSocket(serverUrl).emitWithAck('lobby:updateRoomMeta', { hostSecret, ...patch })
    if (!res?.ok) setToast(res?.message ?? 'Could not update the lobby')
  }

  return (
    <main className="col overviewPage">
      <header className="card overviewHero">
        <div className="overviewIdentity">
          <span className="eyebrow">{match?.status === 'FINISHED' ? 'Match complete' : 'Match lobby'}</span>
          <h1 className="title">{snap?.room?.title || 'Lobby'}</h1>
          {settings ? <div className="lobbyFormat"><strong>{formatName(settings)}</strong><span>{formatRules(settings)}</span></div> : <p className="subtitle">Connecting to room…</p>}
        </div>
          <button className="btn roomCodeBtn" aria-label={`Copy room code ${code}`} onClick={async () => {
            try {
              await navigator.clipboard.writeText(code)
              setToast('Room code copied')
            } catch {
              setToast(`Share room code ${code}`)
            }
            setTimeout(() => setToast(null), 2200)
          }}><small>Copy room code</small><strong>{code}</strong></button>
      </header>

      <SectionTabs group="lobby" label="Lobby sections" tabs={lobbyTabs} active={section} onChange={setSection} />

      <SectionPanel group="lobby" id="players" active={section}>
        {isHost && inLobby ? (
          <div className="card lobbyStartPanel">
            <label className="settingsField">Starting player
              <select className="select" value={startingPlayerIndex} onChange={(e) => setStartingPlayerIndex(Number(e.target.value))} disabled={players.length === 0}>
                {players.map((p, idx) => <option key={p.id} value={idx}>{p.name}</option>)}
              </select>
            </label>
            <button className="btn btnPrimary" onClick={startGame} disabled={players.length === 0}>Start game</button>
          </div>
        ) : null}
        <section className="card sectionCard col">
          <div className="row spread"><h2 className="sectionTitle">Lineup</h2><span className="pill">{players.length} {players.length === 1 ? 'player' : 'players'}</span></div>
          {players.length ? <div className="nameList">{players.map((player, index) => {
            const isYou = ownClient?.name.toLowerCase() === player.name.toLowerCase()
            const starts = inLobby && index === startingPlayerIndex
            return <NameRow key={player.id} name={player.name} marker={<span className="nameMark" aria-hidden="true">{index + 1}</span>}
              badge={isYou ? <span className="nameTag nameTagMuted">You</span> : null}
              detail={starts && isHost ? 'Throws first' : undefined} />
          })}</div> : <p className="help sectionMuted">{snap ? 'No players in the lineup yet.' : 'Waiting for players…'}</p>}
          {canEdit && !snap?.room?.tournamentMatch ? <form className="sectionActionBar" onSubmit={(event) => { event.preventDefault(); if (newPlayer.trim()) void addPlayer() }}>
            <input className="input" value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} placeholder="Player name" aria-label="Add player name" maxLength={32} />
            <button className="btn" type="submit" disabled={!newPlayer.trim()}>Add player</button>
          </form> : null}
        </section>
        <section className="card sectionCard col">
          <div className="row spread"><h2 className="sectionTitle">Spectators</h2><span className="pill">{spectators.length}</span></div>
          {spectators.length ? <div className="nameList">{spectators.map((name) => <NameRow key={name} name={name} />)}</div> : <p className="help sectionMuted">No spectators yet.</p>}
          {ownClient ? <div className="row spread"><span className="help">You’re {iAmPlayer ? 'playing' : 'spectating'}{isHost ? ' · Host' : ''}</span>
            {inLobby && !locked ? <button className="btn" onClick={changeRole}>{iAmPlayer ? 'Switch to spectator' : 'Join lineup'}</button> : null}
          </div> : null}
        </section>
      </SectionPanel>

      <SectionPanel group="lobby" id="rules" active={section}>
        <section className="card sectionCard col">
          <div className="sectionIntro"><h2 className="sectionTitle">Match rules</h2><p className="help">{canEdit ? 'Set the format before starting the match.' : locked || match?.status === 'FINISHED' ? 'The rules are locked for this match.' : 'Only the host can change the rules.'}</p></div>
          {settings ? (canEdit ? <LobbySettings key={JSON.stringify(settings)} settings={settings} onChange={updateSettings} /> : (
            <div className="col"><strong>{formatName(settings)}</strong><span className="help">{formatRules(settings)}</span></div>
          )) : <p className="help">Waiting for match settings…</p>}
        </section>
      </SectionPanel>

      <SectionPanel group="lobby" id="room" active={section}>
        <section className="card sectionCard col">
          <div className="sectionIntro"><h2 className="sectionTitle">Room details</h2><p className="help">{snap?.room?.isPublic ? 'This room appears in Public lobbies.' : 'Private rooms are joined with the room code.'}</p></div>
          <LobbyNameEditor initialValue={snap?.room?.title ?? ''} disabled={!canEdit} onSave={(title) => updateRoomMeta({ title })} />
          <label className="settingToggle"><input type="checkbox" checked={Boolean(snap?.room?.isPublic)} disabled={!canEdit}
            onChange={(e) => void updateRoomMeta({ isPublic: e.target.checked })} /> List in Public lobbies</label>
        </section>
        <section className="card sectionCard col">
          <h2 className="sectionTitle">Invite friends</h2>
          {friends.length ? <div className="nameList">{friends.map((friend) => <NameRow key={friend.user.userId} name={friend.user.displayName}
            detail={friend.online ? 'Online' : 'Offline'} actions={<button className="btn" onClick={() => void inviteFriend(friend.user.userId)}>Invite</button>} />)}</div>
            : <p className="help sectionMuted">Add friends on your <Link href="/account#friends">account</Link> or share room code <strong>{code}</strong>.</p>}
        </section>
      </SectionPanel>

      <SectionPanel group="lobby" id="board" active={section}>
        <section className="card sectionCard col">
          <div className="row spread"><h2 className="sectionTitle">Autodarts</h2><span className="pill">{autodarts?.status === 'CONNECTED' ? 'Connected' : 'Not connected'}</span></div>
          <p className="help sectionMuted">Each player can link a board to their account. It connects when it’s their turn.</p>
          <div className="row"><a className="btn" href="/account#boards" target="_blank" rel="noreferrer">My board settings</a><a className="btn" href="/autodarts" target="_blank" rel="noreferrer">Setup guide</a></div>
          {autodarts?.lastError ? <p className="formError">{autodarts.lastError}</p> : null}
          <details className="sectionFold"><summary>Connection details</summary><div className="row">
            <span className="pill">Status: {autodarts?.status ?? 'DISCONNECTED'}</span>
            <span className="pill">Runtime: {autodarts?.runtimeMode ?? 'MOCK'}</span>
            <span className="pill">Device: {autodarts?.deviceId ?? 'none'}</span>
            <span className="pill">Mode: {autodarts?.mockMode ?? '–'}</span>
            <span className="pill">Active player: {autodartsActiveClient?.name ?? 'none'}</span>
          </div></details>
        </section>
      </SectionPanel>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  )
}

function LobbySettings({
  settings,
  onChange,
}: {
  settings: GameSettings
  onChange: (s: GameSettings) => Promise<void>
}) {
  const [draft, setDraft] = useState<GameSettings>(settings)
  const [saving, setSaving] = useState(false)
  const changed = JSON.stringify(draft) !== JSON.stringify(settings)

  function changeMode(mode: GameSettings['gameType']) {
    if (mode === draft.gameType) return
    const format = { legsToWin: draft.legsToWin, setsEnabled: draft.setsEnabled, setsToWin: draft.setsToWin }
    if (mode === 'X01') setDraft({ ...format, gameType: 'X01', startScore: 501, doubleIn: false, doubleOut: true, masterOut: false })
    else if (mode === 'AROUND') setDraft({ ...format, gameType: 'AROUND', advanceByMultiplier: false })
    else setDraft({ gameType: 'PRACTICE', practiceMode: 'RANDOM_CHECKOUT', startScore: 501, legsToWin: 1, setsEnabled: false, setsToWin: 0 })
  }

  return (
    <form className="col" onSubmit={async (event) => {
      event.preventDefault()
      if (!changed || saving) return
      setSaving(true)
      try { await onChange(draft) } finally { setSaving(false) }
    }}>
      <label className="settingsField">Game mode
        <select className="select" value={draft.gameType} onChange={(e) => changeMode(e.target.value as GameSettings['gameType'])}>
          <option value="X01">X01</option><option value="AROUND">Around the Board</option><option value="PRACTICE">Practice</option>
        </select>
      </label>
      {draft.gameType === 'PRACTICE' ? <label className="settingsField">Practice drill
        <select className="select" value={draft.practiceMode} onChange={(e) => setDraft({ ...draft, practiceMode: e.target.value as PracticeSettings['practiceMode'] })}>
          {Object.entries(practiceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label> : null}
      {draft.gameType === 'X01' || (draft.gameType === 'PRACTICE' && draft.practiceMode === 'X01') ? (
        <div className="settingsField"><span>Starting score</span><div className="settingsOptions" role="group" aria-label="Starting score">
          {allowedX01StartScores.map((score) => <button key={score} type="button" className="btn" aria-pressed={draft.startScore === score} onClick={() => setDraft({ ...draft, startScore: score })}>{score}</button>)}
        </div></div>
      ) : null}
      {draft.gameType !== 'PRACTICE' ? <>
        <h3 className="sectionSubheading">Match length</h3>
        <div className="grid2">
          <label className="settingsField">{draft.setsEnabled ? 'Legs to win a set' : 'Legs to win'}
            <input className="input" type="number" min={1} max={99} value={draft.legsToWin} onChange={(e) => setDraft({ ...draft, legsToWin: clampInt(Number(e.target.value), 1, 99, 1) })} />
          </label>
          {draft.setsEnabled ? <label className="settingsField">Sets to win
            <input className="input" type="number" min={1} max={99} value={draft.setsToWin} onChange={(e) => setDraft({ ...draft, setsToWin: clampInt(Number(e.target.value), 1, 99, 1) })} />
          </label> : null}
        </div>
        <label className="settingToggle"><input type="checkbox" checked={draft.setsEnabled} onChange={(e) => setDraft({ ...draft, setsEnabled: e.target.checked, setsToWin: e.target.checked ? Math.max(1, draft.setsToWin) : 0 })} /> Play in sets</label>
      </> : null}
      {draft.gameType === 'X01' ? <>
        <h3 className="sectionSubheading">Opening and checkout</h3>
        <label className="settingsField">Checkout rule
          <select className="select" value={draft.doubleOut ? 'double' : draft.masterOut ? 'master' : 'straight'} onChange={(e) => setDraft({ ...draft, doubleOut: e.target.value === 'double', masterOut: e.target.value === 'master' })}>
            <option value="double">Double-out</option><option value="master">Master-out</option><option value="straight">Straight-out</option>
          </select>
        </label>
        <label className="settingToggle"><input type="checkbox" checked={draft.doubleIn} onChange={(e) => setDraft({ ...draft, doubleIn: e.target.checked })} /> Double-in</label>
      </> : draft.gameType === 'AROUND' ? <label className="settingToggle"><input type="checkbox" checked={draft.advanceByMultiplier}
        onChange={(e) => setDraft({ ...draft, advanceByMultiplier: e.target.checked })} /> Doubles and trebles advance 2 or 3 targets</label> : null}
      <div className="row"><button className="btn btnPrimary" type="submit" disabled={!changed || saving}>{saving ? 'Saving…' : 'Save rules'}</button>
        <span className="help">{changed ? 'Unsaved changes' : 'Rules are up to date'}</span></div>
    </form>
  )
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.trunc(value)
  if (n < min) return min
  if (n > max) return max
  return n
}

const practiceLabels: Record<PracticeSettings['practiceMode'], string> = {
  RANDOM_CHECKOUT: 'Random checkout', DOUBLES: 'Doubles', TRIPLES: 'Trebles', X01: 'X01 practice',
}

function formatName(settings: GameSettings): string {
  if (settings.gameType === 'X01') return `${settings.startScore} X01`
  if (settings.gameType === 'AROUND') return 'Around the Board'
  return settings.practiceMode === 'X01' ? `${settings.startScore} practice` : practiceLabels[settings.practiceMode]
}

function formatRules(settings: GameSettings): string {
  if (settings.gameType === 'PRACTICE') return 'Single training run'
  const length = settings.setsEnabled ? `First to ${settings.setsToWin} sets` : `First to ${settings.legsToWin} ${settings.legsToWin === 1 ? 'leg' : 'legs'}`
  if (settings.gameType === 'AROUND') return length
  const checkout = settings.doubleOut ? 'Double-out' : settings.masterOut ? 'Master-out' : 'Straight-out'
  return [length, settings.doubleIn ? 'Double-in' : null, checkout].filter(Boolean).join(' · ')
}

function LobbyNameEditor({
  initialValue,
  disabled,
  onSave,
}: {
  initialValue: string
  disabled: boolean
  onSave: (val: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue)
  useEffect(() => setValue(initialValue), [initialValue])

  return (
    <form className="col" onSubmit={(event) => { event.preventDefault(); if (!disabled && value.trim() !== initialValue) void onSave(value.trim()) }}>
      <label className="settingsField">Lobby name
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={48} disabled={disabled} placeholder="Untitled lobby" />
      </label>
      {!disabled ? <div className="row"><button className="btn" type="submit" disabled={value.trim() === initialValue}>Save name</button></div> : null}
    </form>
  )
}
