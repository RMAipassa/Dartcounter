'use client'

import { useEffect, useMemo, useState } from 'react'
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

export default function CreatePage() {
  const router = useRouter()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [creating, setCreating] = useState(false)
  const [settings, setSettings] = useState<X01Settings>(defaultSettings)
  const [title, setTitle] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [name, setName] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const authName = localStorage.getItem('dc_authDisplayName')
    if (authName) {
      setAuthDisplayName(authName)
      setName(authName)
    }
  }, [])

  const effectiveName = authDisplayName?.trim() ? authDisplayName : name

  async function createRoom() {
    setErr(null)
    setCreating(true)
    try {
      const socket = getSocket(serverUrl)
      const rawToken = localStorage.getItem('dc_authToken')
      const authToken = rawToken && rawToken.trim() ? rawToken.trim() : undefined
      const normalizedSettings = normalizeSettingsForCreate(settings)
      const res = await socket.emitWithAck('room:create', {
        name: effectiveName,
        authToken,
        settings: normalizedSettings,
        title,
        isPublic,
      })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to create room')

      localStorage.setItem('dc_name', effectiveName)
      localStorage.setItem('dc_hostSecret', res.hostSecret)
      localStorage.setItem('dc_role', res.role ?? 'PLAYER')
      router.push(`/room/${res.code}/lobby`)
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Create Match</h1>
          <p className="subtitle">Set up your lobby and start when everyone is ready.</p>
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

          <div className="grid2">
            <div className="col">
              <label className="help">Lobby name</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday 501" />
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
            <div className="col" style={{ gridColumn: '1 / -1' }}>
              <label className="help">Quick presets</label>
              <div className="row homePresetRow">
                <button className="btn" type="button" onClick={() => setSettings((s) => ({ ...s, startScore: 301 }))}>301</button>
                <button className="btn" type="button" onClick={() => setSettings((s) => ({ ...s, startScore: 501 }))}>501</button>
                <button className="btn" type="button" onClick={() => setSettings((s) => ({ ...s, startScore: 701 }))}>701</button>
              </div>
            </div>
            <div className="col">
              <label className="help">Start score</label>
              <input className="input" type="number" value={settings.startScore} onChange={(e) => setSettings((s) => ({ ...s, startScore: Number(e.target.value) }))} />
            </div>
            <div className="col">
              <label className="help">Legs to win</label>
              <input className="input" type="number" value={settings.legsToWin} onChange={(e) => setSettings((s) => ({ ...s, legsToWin: Number(e.target.value) }))} />
            </div>
          </div>

          <button className="btn btnPrimary" disabled={creating || !effectiveName.trim()} onClick={createRoom}>
            {creating ? 'Creating...' : 'Create room'}
          </button>
        </div>
      </div>

      {err ? <div className="toast">{err}</div> : null}
    </div>
  )
}

function normalizeSettingsForCreate(settings: X01Settings): X01Settings {
  const startScore = clampInt(settings.startScore, 2, 10001, 501)
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
