'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import { rememberHostSecret, rememberRoomIdentity, roomDeviceKey } from '@/lib/room-session'
import type { AroundSettings, GameSettings, PracticeSettings, X01Settings } from '@/lib/types'

const allowedX01StartScores = [121, 170, 301, 501] as const

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

const defaultAroundSettings: AroundSettings = {
  gameType: 'AROUND',
  legsToWin: 3,
  setsEnabled: false,
  setsToWin: 0,
  advanceByMultiplier: false,
}

const defaultPracticeSettings: PracticeSettings = {
  gameType: 'PRACTICE',
  practiceMode: 'RANDOM_CHECKOUT',
  startScore: 501,
  legsToWin: 1,
  setsEnabled: false,
  setsToWin: 0,
}

const modes = [
  { settings: defaultSettings, label: 'X01', description: 'Count down to zero' },
  { settings: defaultAroundSettings, label: 'Around the Board', description: 'Hit 1 through 20 in order' },
  { settings: defaultPracticeSettings, label: 'Practice', description: 'Train on your own' },
]

export default function CreatePage() {
  const router = useRouter()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [creating, setCreating] = useState(false)
  const [settings, setSettings] = useState<GameSettings>(defaultSettings)
  const [title, setTitle] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [name, setName] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const authName = localStorage.getItem('dc_authDisplayName')
    setName(authName || localStorage.getItem('dc_name') || '')
    if (authName) {
      setAuthDisplayName(authName)
    }
    if (new URLSearchParams(window.location.search).get('mode') === 'practice') setSettings(defaultPracticeSettings)
  }, [])

  const effectiveName = (authDisplayName || name).trim()
  const practice = settings.gameType === 'PRACTICE'

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating || !effectiveName) return
    setErr(null)
    setCreating(true)
    try {
      const socket = getSocket(serverUrl)
      const rawToken = localStorage.getItem('dc_authToken')
      const authToken = rawToken && rawToken.trim() ? rawToken.trim() : undefined
      const normalizedSettings = normalizeSettingsForCreate(settings)
      const res = await socket.emitWithAck('room:create', {
        deviceKey: roomDeviceKey(),
        name: effectiveName,
        authToken,
        settings: normalizedSettings,
        title: normalizedSettings.gameType === 'PRACTICE' ? '' : title,
        isPublic: normalizedSettings.gameType === 'PRACTICE' ? false : isPublic,
      })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to create room')

      localStorage.setItem('dc_name', effectiveName)
      rememberHostSecret(res.code, res.hostSecret)
      rememberRoomIdentity(res.code, effectiveName, res.role ?? 'PLAYER')
      if (normalizedSettings.gameType === 'PRACTICE') router.push(`/room/${res.code}/game`)
      else router.push(`/room/${res.code}/lobby`)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="col setupPage">
      <header className="row spread">
        <div>
          <span className="eyebrow">{practice ? 'Solo training' : 'Match setup'}</span>
          <h1 className="title">{practice ? 'New practice session' : 'New match'}</h1>
          <p className="subtitle">{practice ? 'Choose a drill and go straight to the board.' : 'Pick a game mode, then invite friends or add players at the board.'}</p>
        </div>
        <Link className="btn" href="/join">Join with code</Link>
      </header>

      <form className="card col setupPanel" onSubmit={createRoom}>
          <section className="col" aria-labelledby="mode-heading">
            <h2 id="mode-heading" className="sectionTitle">Game mode</h2>
            <div className="setupModes" role="group" aria-labelledby="mode-heading">
              {modes.map(({ settings: preset, label, description }) => (
                <button key={preset.gameType} className="btn setupMode" type="button" aria-pressed={settings.gameType === preset.gameType}
                  onClick={() => setSettings((s) => s.gameType === preset.gameType ? s : preset)}>
                  {label}<small>{description}</small>
                </button>
              ))}
            </div>
          </section>
          <h2 className="sectionTitle">{practice ? 'Session details' : 'Lobby details'}</h2>
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

          {settings.gameType !== 'PRACTICE' ? (
            <div className="grid2">
              <label className="col help">Lobby name (optional)
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday 501" maxLength={48} />
              </label>
              <div className="col">
                <label className="help">Visibility</label>
                <label className="pill" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                  Public lobby
                </label>
              </div>
            </div>
          ) : null}

          <div className="grid2">
            {settings.gameType === 'X01' ? (
              <>
                <div className="col">
                  <span className="help">Start score</span>
                  <div className="row homePresetRow" style={{ flexWrap: 'wrap' }}>
                    {allowedX01StartScores.map((score) => (
                      <button
                        key={score}
                        className="btn" aria-pressed={settings.startScore === score}
                        type="button"
                        onClick={() => setSettings((s) => ({ ...(s as X01Settings), startScore: score }))}
                      >
                        {score}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col">
                  <label className="help" htmlFor="x01-legs">Legs to win</label>
                  <input
                    id="x01-legs"
                    className="input"
                    type="number"
                    min={1}
                    max={99}
                    value={settings.legsToWin}
                    onChange={(e) => setSettings((s) => ({ ...(s as X01Settings), legsToWin: clampInt(Number(e.target.value), 1, 99, 3) }))}
                  />
                </div>
              </>
            ) : settings.gameType === 'AROUND' ? (
              <div className="grid2" style={{ gridColumn: '1 / -1' }}>
                <div className="col">
                  <label className="help" htmlFor="around-legs">Legs to win</label>
                  <input
                    id="around-legs"
                    className="input"
                    type="number"
                    min={1}
                    max={99}
                    value={settings.legsToWin}
                    onChange={(e) => setSettings((s) => ({ ...(s as AroundSettings), legsToWin: clampInt(Number(e.target.value), 1, 99, 3) }))}
                  />
                </div>
                <div className="col">
                  <label className="help">Around scoring</label>
                  <label className="pill" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settings.advanceByMultiplier}
                      onChange={(e) =>
                        setSettings((s) => ({ ...(s as AroundSettings), advanceByMultiplier: e.target.checked }))
                      }
                    />
                    Double/triple advances 2/3 steps
                  </label>
                </div>
              </div>
            ) : (
              <div className="grid2" style={{ gridColumn: '1 / -1' }}>
                <div className="col" style={{ gridColumn: '1 / -1' }}>
                  <label className="help">Practice mode</label>
                  <div className="row homePresetRow" style={{ flexWrap: 'wrap' }}>
                    <button
                      className={settings.practiceMode === 'RANDOM_CHECKOUT' ? 'btn btnPrimary' : 'btn'}
                      type="button"
                      onClick={() => setSettings((s) => ({ ...(s as PracticeSettings), practiceMode: 'RANDOM_CHECKOUT' }))}
                    >
                      Random checkout
                    </button>
                    <button
                      className={settings.practiceMode === 'DOUBLES' ? 'btn btnPrimary' : 'btn'}
                      type="button"
                      onClick={() => setSettings((s) => ({ ...(s as PracticeSettings), practiceMode: 'DOUBLES' }))}
                    >
                      Doubles
                    </button>
                    <button
                      className={settings.practiceMode === 'TRIPLES' ? 'btn btnPrimary' : 'btn'}
                      type="button"
                      onClick={() => setSettings((s) => ({ ...(s as PracticeSettings), practiceMode: 'TRIPLES' }))}
                    >
                      Triples
                    </button>
                    <button
                      className={settings.practiceMode === 'X01' ? 'btn btnPrimary' : 'btn'}
                      type="button"
                      onClick={() => setSettings((s) => ({ ...(s as PracticeSettings), practiceMode: 'X01' }))}
                    >
                      X01 practice
                    </button>
                  </div>
                </div>
                {settings.practiceMode === 'X01' ? (
                  <div className="col">
                    <label className="help">Start score</label>
                    <div className="row homePresetRow" style={{ flexWrap: 'wrap' }}>
                      {allowedX01StartScores.map((score) => (
                        <button
                          key={score}
                          className={settings.startScore === score ? 'btn btnPrimary' : 'btn'}
                          type="button"
                          onClick={() => setSettings((s) => ({ ...(s as PracticeSettings), startScore: score }))}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="col">
                    <label className="help">Format</label>
                    <span className="pill">Single training run (no legs/sets)</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {err ? <p className="formError" role="alert">{err}</p> : null}
          <div className="row setupFooter">
            <button className="btn btnPrimary" type="submit" disabled={creating || !effectiveName}>
              {creating ? 'Creating…' : practice ? 'Start practice' : 'Create lobby'}
            </button>
          </div>
      </form>
    </main>
  )
}

function normalizeSettingsForCreate(settings: GameSettings): GameSettings {
  if (settings.gameType === 'AROUND') {
    const legsToWin = clampInt(settings.legsToWin, 1, 99, 3)
    const setsEnabled = Boolean(settings.setsEnabled)
    const setsToWin = setsEnabled ? clampInt(settings.setsToWin, 1, 99, 1) : 0
    return {
      gameType: 'AROUND',
      legsToWin,
      setsEnabled,
      setsToWin,
      advanceByMultiplier: Boolean(settings.advanceByMultiplier),
    }
  }

  if (settings.gameType === 'PRACTICE') {
    return {
      gameType: 'PRACTICE',
      practiceMode: settings.practiceMode,
      startScore: normalizeAllowedStartScore(settings.startScore, 501),
      legsToWin: 1,
      setsEnabled: false,
      setsToWin: 0,
    }
  }

  const startScore = normalizeAllowedStartScore(settings.startScore, 501)
  const legsToWin = clampInt(settings.legsToWin, 1, 99, 3)
  const setsEnabled = Boolean(settings.setsEnabled)
  const setsToWin = setsEnabled ? clampInt(settings.setsToWin, 1, 99, 1) : 0

  let doubleOut = Boolean(settings.doubleOut)
  let masterOut = Boolean(settings.masterOut)
  if (doubleOut && masterOut) masterOut = false

  return {
    gameType: 'X01',
    startScore,
    legsToWin,
    setsEnabled,
    setsToWin,
    doubleIn: Boolean(settings.doubleIn),
    doubleOut,
    masterOut,
  }
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

function normalizeAllowedStartScore(value: number, fallback: number): number {
  const n = clampInt(value, 2, 10001, fallback)
  return allowedX01StartScores.includes(n as (typeof allowedX01StartScores)[number]) ? n : fallback
}
