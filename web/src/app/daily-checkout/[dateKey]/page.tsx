'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import type { Dart } from '@/lib/types'

type DailyRow = {
  rank: number
  userId: string
  displayName: string
  dartsUsed: number
  completedAt: number
}

type DailyView = {
  dateKey: string
  target: number
  dayLeaderboardTop10: DailyRow[]
  bestLeaderboardTop10: DailyRow[]
  yourDayStanding: DailyRow | null
  yourBestStanding: DailyRow | null
  dayEntriesCount: number
  bestEntriesCount: number
}

type Turn = {
  visit: number
  darts: Dart[]
  entered: number
  applied: number
  dartsThrown: number
  checkedOutOnDart: number | null
  bust: boolean
  remainingAfter: number
}

type DartKind = 'MISS' | 'S' | 'D' | 'T' | 'SB' | 'DB'

export default function DailyCheckoutGamePage() {
  const params = useParams<{ dateKey: string }>()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const dateKey = String(params?.dateKey ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<DailyView | null>(null)

  const [turns, setTurns] = useState<Turn[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const [darts, setDarts] = useState<Dart[]>(toEditorDarts([]))
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setTurns([])
    setRemaining(null)
    setSubmitted(false)
    void loadView(serverUrl, dateKey, setView, setRemaining, setError)
  }, [serverUrl, dateKey])

  async function refresh() {
    await loadView(serverUrl, dateKey, setView, setRemaining, setError)
  }

  async function addTurn() {
    if (remaining == null || remaining <= 0) return
    setError(null)

    const entered = darts.reduce((sum, d) => sum + dartPoints(d), 0)
    const applied = applyDailyVisit(remaining, darts)
    const bust = applied.bust
    const nextRemaining = applied.remainingAfter
    const nextTurns = [
      ...turns,
      {
        visit: turns.length + 1,
        darts: darts.map((d) => ({ ...d })),
        entered,
        applied: applied.scoreApplied,
        dartsThrown: applied.dartsThrown,
        checkedOutOnDart: applied.checkoutDartIndex == null ? null : applied.checkoutDartIndex + 1,
        bust,
        remainingAfter: nextRemaining,
      },
    ]
    setTurns(nextTurns)
    setRemaining(nextRemaining)
    setDarts(toEditorDarts([]))

    if (nextRemaining === 0 && !submitted) {
      const dartsUsed = nextTurns.reduce((sum, t) => sum + t.dartsThrown, 0)
      await submitResult(dartsUsed)
    }
  }

  async function submitResult(dartsUsed: number) {
    if (submitted) return
    setBusy(true)
    setError(null)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Sign in to submit your score.')
      const res = await fetch(`${serverUrl}/api/daily-checkout/submit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dateKey, dartsUsed }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Could not submit result')

      setView({
        dateKey: String(data.dateKey),
        target: Number(data.target),
        dayLeaderboardTop10: Array.isArray(data.dayLeaderboardTop10) ? data.dayLeaderboardTop10 : [],
        bestLeaderboardTop10: Array.isArray(data.bestLeaderboardTop10) ? data.bestLeaderboardTop10 : [],
        yourDayStanding: data.yourDayStanding ?? null,
        yourBestStanding: data.yourBestStanding ?? null,
        dayEntriesCount: Number(data.dayEntriesCount ?? 0),
        bestEntriesCount: Number(data.bestEntriesCount ?? 0),
      })
      setSubmitted(true)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  function resetRun() {
    if (!view) return
    setTurns([])
    setRemaining(view.target)
    setDarts(toEditorDarts([]))
    setSubmitted(false)
    setError(null)
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h1 className="title">Daily Checkout Game</h1>
            <p className="subtitle">Use the same 3-dart editor as X01 and submit one full turn at a time.</p>
          </div>
          <a className="btn" href="/daily-checkout">
            Back to calendar
          </a>
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <span className="pill">Day: {view?.dateKey ?? dateKey}</span>
          <span className="pill">Target: {view?.target ?? '-'}</span>
          <span className="pill">Remaining: {remaining ?? '-'}</span>
          <span className="pill">Visits: {turns.length}</span>
          <span className="pill">Darts used: {turns.reduce((sum, t) => sum + t.dartsThrown, 0)}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Play</div>
        <div className="col" style={{ gap: 10 }}>
          <PerDartEditor darts={darts} onChange={(next) => setDarts(toEditorDarts(next))} />
        </div>
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <button className="btn btnPrimary" onClick={() => void addTurn()} disabled={busy || remaining === 0 || view == null}>
            Add 3-dart turn
          </button>
          <button className="btn" onClick={resetRun} disabled={busy || view == null}>
            Reset run
          </button>
          <button className="btn" onClick={() => void refresh()} disabled={busy || view == null}>
            Refresh boards
          </button>
        </div>
        {remaining === 0 ? <div className="pill" style={{ marginTop: 8, color: 'var(--good)' }}>Checkout complete. Submitted.</div> : null}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Run log</div>
        <div className="col">
          {turns.length < 1 ? <span className="pill">No visits yet</span> : null}
          {turns.map((t) => (
            <div key={t.visit} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="pill">Visit {t.visit}</span>
              <span className="pill">Darts: {t.darts.map((d) => dartToLabel(d)).join(', ')}</span>
              <span className="pill">Entered: {t.entered}</span>
              <span className="pill">Applied: {t.applied}</span>
              <span className="pill">Thrown: {t.dartsThrown}</span>
              {t.checkedOutOnDart ? <span className="pill">Checkout dart: {t.checkedOutOnDart}</span> : null}
              <span className="pill">{t.bust ? 'Bust' : 'Valid'}</span>
              <span className="pill">Remaining: {t.remainingAfter}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid2">
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Day leaderboard (Top 10)</div>
          <div className="col">
            {(view?.dayLeaderboardTop10 ?? []).length < 1 ? <span className="pill">No day results yet</span> : null}
            {(view?.dayLeaderboardTop10 ?? []).map((row) => (
              <div key={`d-${row.userId}-${row.rank}`} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill">#{row.rank}</span>
                <span className="pill">{row.displayName}</span>
                <span className="pill">{row.dartsUsed} darts</span>
              </div>
            ))}
            <span className="pill">You: {view?.yourDayStanding ? `#${view.yourDayStanding.rank} (${view.yourDayStanding.dartsUsed})` : '-'}</span>
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Permanent best leaderboard (Top 10)</div>
          <div className="col">
            {(view?.bestLeaderboardTop10 ?? []).length < 1 ? <span className="pill">No best results yet</span> : null}
            {(view?.bestLeaderboardTop10 ?? []).map((row) => (
              <div key={`b-${row.userId}-${row.rank}`} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill">#{row.rank}</span>
                <span className="pill">{row.displayName}</span>
                <span className="pill">{row.dartsUsed} darts</span>
              </div>
            ))}
            <span className="pill">You: {view?.yourBestStanding ? `#${view.yourBestStanding.rank} (${view.yourBestStanding.dartsUsed})` : '-'}</span>
          </div>
        </div>
      </div>

      {error ? <div className="toast">{error}</div> : null}
    </div>
  )
}

function dartPoints(d: Dart): number {
  if (!d || d.multiplier === 0) return 0
  return d.segment === 25 ? (d.multiplier === 2 ? 50 : 25) : d.segment * d.multiplier
}

function applyDailyVisit(
  remainingBefore: number,
  darts: Dart[],
): {
  scoreApplied: number
  remainingAfter: number
  bust: boolean
  dartsThrown: number
  checkoutDartIndex: number | null
} {
  let remaining = remainingBefore
  let scored = 0

  for (let i = 0; i < darts.length; i++) {
    const val = dartPoints(darts[i])
    const next = remaining - val

    if (next < 0) {
      return {
        scoreApplied: 0,
        remainingAfter: remainingBefore,
        bust: true,
        dartsThrown: i + 1,
        checkoutDartIndex: null,
      }
    }

    scored += val
    remaining = next

    if (remaining === 0) {
      return {
        scoreApplied: scored,
        remainingAfter: 0,
        bust: false,
        dartsThrown: i + 1,
        checkoutDartIndex: i,
      }
    }
  }

  return {
    scoreApplied: scored,
    remainingAfter: remaining,
    bust: false,
    dartsThrown: darts.length,
    checkoutDartIndex: null,
  }
}

function dartToLabel(d: Dart): string {
  if (!d || d.multiplier === 0) return 'MISS'
  if (d.segment === 25 && d.multiplier === 1) return 'SB'
  if (d.segment === 25 && d.multiplier === 2) return 'DB'
  if (d.multiplier === 1) return `S${d.segment}`
  return `${d.multiplier === 2 ? 'D' : 'T'}${d.segment}`
}

function toEditorDarts(input: Dart[]): Dart[] {
  const out = Array.isArray(input) ? input.map((d) => ({ segment: d.segment, multiplier: d.multiplier })) : []
  while (out.length < 3) out.push({ segment: 0, multiplier: 0 })
  return out.slice(0, 3)
}

function kindFromDart(d: Dart): DartKind {
  if (d.multiplier === 0) return 'MISS'
  if (d.segment === 25 && d.multiplier === 1) return 'SB'
  if (d.segment === 25 && d.multiplier === 2) return 'DB'
  if (d.multiplier === 3) return 'T'
  if (d.multiplier === 2) return 'D'
  return 'S'
}

function dartFrom(kind: DartKind, segment: number): Dart {
  if (kind === 'MISS') return { segment: 0, multiplier: 0 }
  if (kind === 'SB') return { segment: 25, multiplier: 1 }
  if (kind === 'DB') return { segment: 25, multiplier: 2 }
  const seg = Math.max(1, Math.min(20, Math.floor(segment)))
  if (kind === 'T') return { segment: seg, multiplier: 3 }
  if (kind === 'D') return { segment: seg, multiplier: 2 }
  return { segment: seg, multiplier: 1 }
}

function PerDartEditor({ darts, onChange }: { darts: Dart[]; onChange: (d: Dart[]) => void }) {
  const isMobile = useMediaQuery('(max-width: 520px)')
  if (isMobile) return <MobilePerDartEditor darts={darts} onChange={onChange} />
  return <PcPerDartEditor darts={darts} onChange={onChange} />
}

function PcPerDartEditor({ darts, onChange }: { darts: Dart[]; onChange: (d: Dart[]) => void }) {
  const [segText, setSegText] = useState<string[]>(() =>
    [0, 1, 2].map((i) => String((darts[i]?.segment ?? 20) === 25 ? 20 : darts[i]?.segment ?? 20)),
  )

  useEffect(() => {
    setSegText([0, 1, 2].map((i) => String((darts[i]?.segment ?? 20) === 25 ? 20 : darts[i]?.segment ?? 20)))
  }, [darts])

  function setDart(i: number, next: Dart) {
    const out = darts.map((d, idx) => (idx === i ? next : d))
    onChange(out)
  }

  function setKind(i: number, kind: DartKind) {
    const currentSeg = Number(segText[i] ?? '20')
    const seg = Number.isFinite(currentSeg) ? currentSeg : 20
    setDart(i, dartFrom(kind, seg))
  }

  function setSegment(i: number, raw: string) {
    const v = raw.replace(/[^0-9]/g, '').slice(0, 2)
    setSegText((s) => s.map((x, idx) => (idx === i ? v : x)))
    const n = v === '' ? NaN : Number(v)
    if (!Number.isFinite(n)) return
    const k = kindFromDart(darts[i] ?? { segment: 20, multiplier: 1 })
    if (k === 'MISS' || k === 'SB' || k === 'DB') return
    setDart(i, dartFrom(k, n))
  }

  return (
    <div className="col">
      <div className="help">Enter each dart as Single/Double/Triple + segment 1-20, or SB (25) / DB (50) / Miss.</div>
      <div className="grid2">
        {[0, 1, 2].map((i) => {
          const d = darts[i] ?? { segment: 20, multiplier: 1 }
          const kind = kindFromDart(d)
          const needsSeg = kind === 'S' || kind === 'D' || kind === 'T'
          return (
            <div key={i} className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
              <div className="help" style={{ marginBottom: 8 }}>Dart {i + 1}</div>
              <div className="col">
                <select className="select" value={kind} onChange={(e) => setKind(i, e.target.value as DartKind)}>
                  <option value="MISS">Miss</option>
                  <option value="S">Single</option>
                  <option value="D">Double</option>
                  <option value="T">Triple</option>
                  <option value="SB">Single bull (25)</option>
                  <option value="DB">Bullseye (50)</option>
                </select>
                <input
                  className="input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="1-20"
                  disabled={!needsSeg}
                  value={needsSeg ? segText[i] ?? '' : ''}
                  onChange={(e) => setSegment(i, e.target.value)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MobilePerDartEditor({ darts, onChange }: { darts: Dart[]; onChange: (d: Dart[]) => void }) {
  const [active, setActive] = useState<0 | 1 | 2>(0)
  const [panel, setPanel] = useState<'KIND' | 'SEG'>('KIND')
  const current = darts[active] ?? { segment: 20, multiplier: 1 }
  const kind = kindFromDart(current)
  const needsSeg = kind === 'S' || kind === 'D' || kind === 'T'

  useEffect(() => {
    const allMisses = darts.every((d) => d.multiplier === 0)
    if (allMisses) {
      setActive(0)
      setPanel('KIND')
    }
  }, [darts])

  function setDart(i: 0 | 1 | 2, next: Dart) {
    const out = darts.map((d, idx) => (idx === i ? next : d))
    onChange(out)
  }

  function setKind(nextKind: DartKind) {
    const seg = current.segment === 25 ? 20 : current.segment || 20
    setDart(active, dartFrom(nextKind, seg))
    if (nextKind === 'S' || nextKind === 'D' || nextKind === 'T') setPanel('SEG')
    else setPanel('KIND')
  }

  function setSegment(seg: number) {
    setDart(active, dartFrom(kind === 'S' || kind === 'D' || kind === 'T' ? kind : 'S', seg))
  }

  return (
    <div className="col">
      <div className="help">Tap each dart (no typing).</div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="pill">Dart {active + 1} · {kind}{needsSeg ? ` ${current.segment}` : ''}</span>
        <div className="row">
          {[0, 1, 2].map((i) => (
            <button key={i} className={active === i ? 'btn btnPrimary' : 'btn'} onClick={() => setActive(i as 0 | 1 | 2)}>
              {i + 1}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <button className={panel === 'KIND' ? 'btn btnPrimary' : 'btn'} onClick={() => setPanel('KIND')}>
          Type
        </button>
        <button className={panel === 'SEG' ? 'btn btnPrimary' : 'btn'} onClick={() => setPanel('SEG')} disabled={!needsSeg}>
          Segment
        </button>
        <span className="pill">{needsSeg ? '1-20' : kind === 'SB' ? '25' : kind === 'DB' ? '50' : ''}</span>
      </div>
      {panel === 'KIND' ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className={kind === 'MISS' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('MISS')}>Miss</button>
          <button className={kind === 'S' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('S')}>Single</button>
          <button className={kind === 'D' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('D')}>Double</button>
          <button className={kind === 'T' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('T')}>Triple</button>
          <button className={kind === 'SB' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('SB')}>SB</button>
          <button className={kind === 'DB' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('DB')}>DB</button>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="segGrid">
            {Array.from({ length: 20 }, (_, idx) => idx + 1).map((n) => (
              <button key={n} className={n === current.segment ? 'key keyPrimary' : 'key'} onClick={() => setSegment(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button
          className="btn"
          onClick={() => {
            setActive((a) => (a === 0 ? 0 : ((a - 1) as 0 | 1 | 2)))
            setPanel('KIND')
          }}
        >
          Back
        </button>
        <button
          className="btn btnPrimary"
          onClick={() => {
            setActive((a) => (a === 2 ? 2 : ((a + 1) as 0 | 1 | 2)))
            setPanel('KIND')
          }}
        >
          Next
        </button>
      </div>
    </div>
  )
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const m = window.matchMedia(query)
    const onChange = () => setMatches(Boolean(m.matches))
    onChange()
    if (typeof m.addEventListener === 'function') m.addEventListener('change', onChange)
    else m.addListener(onChange)
    return () => {
      if (typeof m.removeEventListener === 'function') m.removeEventListener('change', onChange)
      else m.removeListener(onChange)
    }
  }, [query])

  return matches
}

async function loadView(
  serverUrl: string,
  dateKey: string,
  setView: (v: DailyView | null) => void,
  setRemaining: (v: number | null) => void,
  setError: (v: string | null) => void,
) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
  const res = await fetch(`${serverUrl}/api/daily-checkout?dateKey=${encodeURIComponent(dateKey)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) {
    setView(null)
    setRemaining(null)
    setError(data?.message ?? 'Could not load daily checkout day')
    return
  }
  const target = Number(data.target)
  setView({
    dateKey: String(data.dateKey),
    target,
    dayLeaderboardTop10: Array.isArray(data.dayLeaderboardTop10) ? data.dayLeaderboardTop10 : [],
    bestLeaderboardTop10: Array.isArray(data.bestLeaderboardTop10) ? data.bestLeaderboardTop10 : [],
    yourDayStanding: data.yourDayStanding ?? null,
    yourBestStanding: data.yourBestStanding ?? null,
    dayEntriesCount: Number(data.dayEntriesCount ?? 0),
    bestEntriesCount: Number(data.bestEntriesCount ?? 0),
  })
  setRemaining(target)
  setError(null)
}
