'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import type { Dart } from '@/lib/types'
import DartKeypad from '@/components/DartKeypad'
import { ScoringHeader, ScoringMenu, ScoringMenuSection } from '@/components/ScoringScreen'

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
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    setTurns([])
    setDarts(toEditorDarts([]))
    setRevision((previous) => previous + 1)
    setRemaining(null)
    setSubmitted(false)
    void loadView(serverUrl, dateKey, setView, setRemaining, setError)
  }, [serverUrl, dateKey])

  async function refresh() {
    await loadView(serverUrl, dateKey, setView, () => {}, setError)
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
    setRevision((previous) => previous + 1)

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
    setRevision((previous) => previous + 1)
    setSubmitted(false)
    setError(null)
  }

  return (
    <main className="gamePage">
      <ScoringHeader title="Daily checkout" detail={view?.dateKey ?? dateKey} back="/daily-checkout" backLabel="Back to calendar" />
      <div className="gameGrid" data-entry={remaining !== 0}>
        <section className="scoreboard" aria-label="Checkout score">
          <div className="gamePlayers" data-solo="true">
            <article className="playerCard" data-current="true">
              <div className="scoreCardHeader"><strong className="scoreName">{remaining === 0 ? 'Checkout complete' : 'Remaining'}</strong><span className="scoreTurn">Double out</span></div>
              <div className="playerBigNum">{remaining ?? '–'}</div>
              <div className="scoreMeta"><span>Target {view?.target ?? '–'}</span><span>{turns.length} visits</span><span>{turns.reduce((sum, t) => sum + t.dartsThrown, 0)} darts</span></div>
            </article>
          </div>
          {remaining === 0 ? <div className="turnBanner" role="status">{busy ? 'Submitting result…' : submitted ? 'Result submitted' : 'Result not submitted'}</div> : null}
        </section>
        {remaining !== 0 ? <fieldset className="card turnEntry" disabled={busy || remaining == null || !view}>
          <legend className="srOnly">Enter visit</legend>
          <div className="entryDisplay"><span className="entryTitle">Enter visit</span><output className="entryScore">{darts.reduce((sum, dart) => sum + dartPoints(dart), 0)}</output></div>
          <DartKeypad darts={darts} onChange={setDarts} revision={revision} />
          <button className="btn btnPrimary entrySubmit" onClick={() => void addTurn()}>Submit visit</button>
        </fieldset> : null}
      </div>

      <ScoringMenu>
        <ScoringMenuSection title="Run settings">
          <div className="row">
            <button className="btn" onClick={resetRun} disabled={busy || view == null}>Reset run</button>
            <button className="btn" onClick={() => void refresh()} disabled={busy || view == null}>Refresh leaderboards</button>
            {remaining === 0 && !submitted ? <button className="btn btnPrimary" disabled={busy} onClick={() => void submitResult(turns.reduce((sum, t) => sum + t.dartsThrown, 0))}>Retry result</button> : null}
          </div>
        </ScoringMenuSection>
        <ScoringMenuSection title="Visit history" hint={`${turns.length} this run`}>
        <div className="col">
          {turns.length < 1 ? <span className="pill">No visits yet</span> : null}
          {turns.map((t) => (
            <div key={t.visit} className="row">
              <span className="pill">Visit {t.visit}</span>
              <span className="pill">Darts: {t.darts.map((d) => dartToLabel(d)).join(', ')}</span>
              <span className="pill">Entered: {t.entered}</span>
              <span className="pill">Applied: {t.applied}</span>
              <span className="pill">Thrown: {t.dartsThrown}</span>
              {t.checkedOutOnDart ? <span className="pill">Checkout dart: {t.checkedOutOnDart}</span> : null}
              {t.bust ? <span className="pill">Bust</span> : null}
              <span className="pill">Remaining: {t.remainingAfter}</span>
            </div>
          ))}
        </div>
        </ScoringMenuSection>

      <ScoringMenuSection title="Leaderboards">
      <div className="col">
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
      </ScoringMenuSection>
      </ScoringMenu>

      {error ? <div className="toast" role="alert">{error}</div> : null}
    </main>
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
