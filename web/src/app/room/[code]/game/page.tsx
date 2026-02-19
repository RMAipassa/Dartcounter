'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type { Dart, MatchSnapshot, Player, PlayerStats, RoomSnapshot } from '@/lib/types'
import { suggestCheckout, type OutRule } from '@/lib/checkout'

export default function GamePage() {
  const params = useParams<{ code: string }>()
  const code = (params.code ?? '').toUpperCase()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [snap, setSnap] = useState<RoomSnapshot | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [total, setTotal] = useState<number>(60)
  const [totalText, setTotalText] = useState<string>('60')
  const [entryMode, setEntryMode] = useState<'TOTAL' | 'PER_DART'>('TOTAL')
  const [darts, setDarts] = useState<Dart[]>([
    { segment: 20, multiplier: 1 },
    { segment: 20, multiplier: 1 },
    { segment: 20, multiplier: 1 },
  ])

  const [needDarts, setNeedDarts] = useState<null | 'DOUBLE_IN'>(null)

  useEffect(() => {
    const next = String(total)
    if (totalText !== next) setTotalText(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  const hostSecret = typeof window !== 'undefined' ? localStorage.getItem('dc_hostSecret') : null

  useEffect(() => {
    const socket = getSocket(serverUrl)
    let mounted = true

    socket.on('room:snapshot', (s: any) => {
      if (!mounted) return
      if (s?.code?.toUpperCase?.() !== code) return
      setSnap(s)
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
      })

    return () => {
      mounted = false
      socket.off('room:snapshot')
    }
  }, [code, hostSecret, serverUrl])

  const match = snap?.match
  const leg = match?.leg
  const settings = match?.settings
  const players = match?.players ?? []
  const currentIdx = leg?.currentPlayerIndex ?? -1
  const currentPlayer = currentIdx >= 0 ? players[currentIdx] : null
  const finished = match?.status === 'FINISHED'
  const statsByPlayerId = match?.statsByPlayerId ?? {}

  const currentLegPlayer = currentPlayer ? leg?.players?.find((p) => p.playerId === currentPlayer.id) : null
  const outRule: OutRule = settings?.doubleOut ? 'DOUBLE' : settings?.masterOut ? 'MASTER' : 'ANY'
  const checkoutMax = outRule === 'MASTER' ? 180 : 170
  const checkoutSuggestion =
    currentLegPlayer &&
    currentLegPlayer.isIn &&
    currentLegPlayer.remaining <= checkoutMax &&
    currentLegPlayer.remaining > 1
      ? suggestCheckout({ remaining: currentLegPlayer.remaining, outRule })
      : null

  const isMobile = useMediaQuery('(max-width: 520px)')
  const showOnlyCurrent = players.length > 3
  const visiblePlayers = showOnlyCurrent && currentPlayer ? [currentPlayer] : players

  const [scoresTab, setScoresTab] = useState<'RECENT' | 'ALL'>('RECENT')

  async function submitTurn(withDarts?: boolean) {
    try {
      setToast(null)
      const socket = getSocket(serverUrl)
      const payload: any = {}

      if (entryMode === 'PER_DART') {
        payload.darts = darts
      } else {
        payload.total = total
        if (withDarts) payload.darts = darts
      }

      const res = await socket.emitWithAck('game:submitTurn', payload)
      if (!res?.ok) {
        if (res?.code === 'NEED_DARTS_FOR_DOUBLE_IN') setNeedDarts('DOUBLE_IN')
        throw new Error(res?.message ?? 'Failed')
      }
      setNeedDarts(null)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="desktopOnly">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="title">Game</h1>
            <p className="subtitle">
              {settings ? (
                <span className="pill">
                  {settings.startScore} · {settings.doubleIn ? 'DI' : 'SI'} · {settings.doubleOut ? 'DO' : settings.masterOut ? 'MO' : 'SO'}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </div>

      <div className="mobileOnly fullBleed">
        <MobileGame
          code={code}
          match={match}
          leg={leg}
          players={players}
          currentPlayer={currentPlayer}
          statsByPlayerId={statsByPlayerId}
          checkoutSuggestion={checkoutSuggestion}
          canSubmit={currentPlayer ? canSubmitForCurrent(code, currentPlayer.id) : false}
          onSubmit={submitTurn}
          entryMode={entryMode}
          setEntryMode={setEntryMode}
          totalText={totalText}
          setTotalText={setTotalText}
          total={total}
          setTotal={setTotal}
          darts={darts}
          setDarts={setDarts}
          finished={finished}
        />
      </div>

      <div className="desktopOnly">
        <div className="grid2">
          <div className="card" style={{ padding: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, marginBottom: 6 }}>Scoreboard</div>
                <div className="help">{showOnlyCurrent ? 'Showing current player only.' : 'Each player has their own table.'}</div>
              </div>
              {match ? <span className="pill">Set {match.currentSetNumber} · Leg {match.currentLeg.legNumber}</span> : null}
            </div>

            <div className={showOnlyCurrent ? 'col' : 'grid3'} style={{ marginTop: 10 }}>
              {visiblePlayers.map((p) => (
                <PlayerPanel
                  key={p.id}
                  player={p}
                  isCurrent={p.id === currentPlayer?.id}
                  leg={leg}
                  settings={settings}
                  match={match}
                  stats={statsByPlayerId[p.id]}
                />
              ))}
            </div>
          </div>

          <EnterTurnCard
            currentPlayer={currentPlayer}
            checkoutSuggestion={checkoutSuggestion}
            entryMode={entryMode}
            setEntryMode={setEntryMode}
            darts={darts}
            setDarts={setDarts}
            totalText={totalText}
            setTotalText={setTotalText}
            total={total}
            setTotal={setTotal}
            needDarts={needDarts}
            setNeedDarts={setNeedDarts}
            submitTurn={submitTurn}
            settings={settings}
            finished={finished}
            canSubmit={currentPlayer ? canSubmitForCurrent(code, currentPlayer.id) : false}
          />
        </div>
      </div>

      <div className="desktopOnly">
        <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, marginBottom: 6 }}>Scores</div>
            <div className="help">Recent by default; switch to see the full leg history.</div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setScoresTab('RECENT')} disabled={scoresTab === 'RECENT'}>
              Recent scores
            </button>
            <button className="btn" onClick={() => setScoresTab('ALL')} disabled={scoresTab === 'ALL'}>
              All turns
            </button>
          </div>
        </div>

        <div className="col" style={{ marginTop: 10 }}>
          <ScoresByPlayer
            tab={scoresTab}
            turns={leg?.turns ?? []}
            players={showOnlyCurrent ? visiblePlayers : players}
            recentVisitsPerPlayer={6}
          />
        </div>
      </div>

        <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, marginBottom: 6 }}>Player stats</div>
            <div className="help">Computed from turns (total mode assumes 3 darts per visit).</div>
          </div>
        </div>

        <div className="col" style={{ marginTop: 10 }}>
          {players.map((p) => {
            const s = statsByPlayerId[p.id]
            if (!s) return null
            return (
              <div
                key={p.id}
                className="card"
                style={{ padding: 12, background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="pill" style={{ color: 'var(--text)' }}>{p.name}</span>
                  <span className="pill">Avg: {s.threeDartAvg ?? '-'}</span>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {match?.settings?.setsEnabled ? <span className="pill">Sets: {s.setsWon}</span> : null}
                  <span className="pill">Legs: {s.legsWon}</span>
                  <span className="pill">First 9: {s.first9Avg ?? '-'}</span>
                  <span className="pill">CO%: {s.checkoutRate == null ? '-' : `${s.checkoutRate}%`}</span>
                  <span className="pill">Hi finish: {s.highestFinish ?? '-'}</span>
                  <span className="pill">Hi score: {s.highestScore}</span>
                  <span className="pill">Best leg: {s.bestLegDarts == null ? '-' : `${s.bestLegDarts} darts`}</span>
                  <span className="pill">Worst leg: {s.worstLegDarts == null ? '-' : `${s.worstLegDarts} darts`}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

function MobileGame({
  code,
  match,
  leg,
  players,
  currentPlayer,
  statsByPlayerId,
  checkoutSuggestion,
  canSubmit,
  onSubmit,
  entryMode,
  setEntryMode,
  totalText,
  setTotalText,
  total,
  setTotal,
  darts,
  setDarts,
  finished,
}: {
  code: string
  match: MatchSnapshot | undefined
  leg: MatchSnapshot['leg'] | undefined
  players: Player[]
  currentPlayer: Player | null
  statsByPlayerId: Record<string, PlayerStats>
  checkoutSuggestion: { labels: string[] } | null
  canSubmit: boolean
  onSubmit: (withDarts?: boolean) => Promise<void>
  entryMode: 'TOTAL' | 'PER_DART'
  setEntryMode: (m: 'TOTAL' | 'PER_DART') => void
  totalText: string
  setTotalText: (t: string) => void
  total: number
  setTotal: (n: number) => void
  darts: Dart[]
  setDarts: (d: Dart[]) => void
  finished: boolean
}) {
  const p = currentPlayer
  const stats = p ? statsByPlayerId[p.id] : undefined
  const ps = p ? leg?.players?.find((x) => x.playerId === p.id) : undefined

  const last = p ? lastScoreForPlayer(leg?.turns ?? [], p.id) : null
  const thrown = p ? dartsThrownForPlayer(leg?.turns ?? [], p.id) : 0

  return (
    <div className="mobileGame">
      <div className="mobileGameTop">
        <button
          className="mobileIconBtn"
          onClick={() => {
            if (window.history.length > 1) window.history.back()
            else window.location.href = '/'
          }}
          aria-label="Back"
        >
          <svg className="mobileIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="mobileHeaderTitle">
          {match?.settings?.setsEnabled ? `FIRST TO ${match.settings.setsToWin} SETS` : `FIRST TO ${match?.settings?.legsToWin ?? 0} LEGS`}
        </div>
        <button
          className="mobileIconBtn"
          onClick={() => window.dispatchEvent(new Event('dc:openMenu'))}
          aria-label="Menu"
        >
          <svg className="mobileIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className={canSubmit && !finished ? `playerCard playerCardUp` : 'playerCard'}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="row">
            <span className="pill" style={{ color: 'var(--text)' }}>{p?.name ?? 'Waiting...'}</span>
            {match ? <span className="pill">Set {match.currentSetNumber} · Leg {match.currentLeg.legNumber}</span> : null}
          </div>
          {match ? (
            <span className="pill">
              {match.settings.startScore} · {match.settings.doubleIn ? 'DI' : 'SI'} · {match.settings.doubleOut ? 'DO' : match.settings.masterOut ? 'MO' : 'SO'}
            </span>
          ) : null}
        </div>

        <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          {match?.settings?.setsEnabled ? <span className="pill">Sets won: {stats?.setsWon ?? 0}</span> : null}
          <span className="pill">Legs won: {stats?.legsWon ?? 0}</span>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
          <div className="playerBigNum">{ps?.remaining ?? '-'}</div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
            <span className="pill">3-dart avg: {stats?.threeDartAvg ?? '-'}</span>
            <span className="pill">Last score: {last ?? '-'}</span>
            <span className="pill">Darts thrown: {thrown}</span>
          </div>
        </div>

        {checkoutSuggestion ? (
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <span className="pill">Checkout</span>
            <span className="pill" style={{ color: 'var(--text)' }}>{checkoutSuggestion.labels.join('  ')}</span>
          </div>
        ) : null}
      </div>

      <div className="turnBanner">{canSubmit && !finished ? "IT'S YOUR TURN" : finished ? 'FINISHED' : 'WAITING'}</div>

      <MobileTurnEntry
        entryMode={entryMode}
        setEntryMode={setEntryMode}
        totalText={totalText}
        setTotalText={setTotalText}
        total={total}
        setTotal={setTotal}
        darts={darts}
        setDarts={setDarts}
        canSubmit={canSubmit && !finished}
        onSubmit={() => onSubmit(false)}
      />
    </div>
  )
}

function lastScoreForPlayer(turns: MatchSnapshot['leg']['turns'], playerId: string): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.playerId === playerId) return t.scoreTotal
  }
  return null
}

function dartsThrownForPlayer(turns: MatchSnapshot['leg']['turns'], playerId: string): number {
  let sum = 0
  for (const t of turns) {
    if (t.playerId !== playerId) continue
    if (t.input?.mode === 'PER_DART' && Array.isArray(t.input.darts)) sum += t.input.darts.length
    else if (t.input?.mode === 'TOTAL' && Array.isArray(t.input.darts)) sum += t.input.darts.length
    else sum += 3
  }
  return sum
}

function MobileTurnEntry({
  entryMode,
  setEntryMode,
  totalText,
  setTotalText,
  total,
  setTotal,
  darts,
  setDarts,
  canSubmit,
  onSubmit,
}: {
  entryMode: 'TOTAL' | 'PER_DART'
  setEntryMode: (m: 'TOTAL' | 'PER_DART') => void
  totalText: string
  setTotalText: (t: string) => void
  total: number
  setTotal: (n: number) => void
  darts: Dart[]
  setDarts: (d: Dart[]) => void
  canSubmit: boolean
  onSubmit: () => void
}) {
  const [dartMode, setDartMode] = useState<'S' | 'D' | 'T' | 'DB' | 'SB'>('S')
  const [dartCursor, setDartCursor] = useState(0)

  const labels = darts.map((d) => dartToLabel(d))
  const totalFromDarts = darts.reduce((acc, d) => acc + dartPoints(d), 0)

  function resetDarts() {
    setDarts([
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
    ])
    setDartCursor(0)
  }

  function setDigit(d: string) {
    const raw = (totalText + d).replace(/^0+(?=\d)/, '')

    function pickValid(s: string): string {
      const cleaned = s.replace(/^0+(?=\d)/, '')
      const n = cleaned === '' ? 0 : Number(cleaned)
      if (!Number.isFinite(n)) return ''
      if (n < 0 || n > 180) return ''
      return cleaned
    }

    // Prefer the longest valid suffix (3 -> 2 -> 1 digits), so:
    // 616 -> 16, 189 -> 89, 66120 -> 120
    const candidates: string[] = []
    const digits = raw.replace(/[^0-9]/g, '')
    if (digits.length <= 3) candidates.push(digits)
    else candidates.push(digits.slice(-3))
    candidates.push(digits.slice(-2))
    candidates.push(digits.slice(-1))

    let next = ''
    for (const c of candidates) {
      const v = pickValid(c)
      if (v !== '') {
        next = v
        break
      }
    }

    setTotalText(next)
    setTotal(next === '' ? 0 : Number(next))
  }

  function backspace() {
    const next = totalText.slice(0, -1)
    setTotalText(next)
    const n = next === '' ? 0 : Number(next)
    if (Number.isFinite(n)) setTotal(Math.min(180, n))
  }

  function clear() {
    setTotalText('')
    setTotal(0)
  }

  function miss() {
    if (entryMode !== 'PER_DART') return
    const idx = Math.min(2, dartCursor)
    const out = darts.map((d, i) => (i === idx ? ({ segment: 0, multiplier: 0 } as Dart) : d))
    setDarts(out)
    setDartCursor(Math.min(3, dartCursor + 1))
  }

  function undoDart() {
    if (entryMode !== 'PER_DART') return
    const nextCursor = Math.max(0, dartCursor - 1)
    const idx = Math.min(2, nextCursor)
    const out = darts.map((d, i) => (i === idx ? ({ segment: 0, multiplier: 0 } as Dart) : d))
    setDarts(out)
    setDartCursor(nextCursor)
  }

  function applySegment(seg: number) {
    if (entryMode !== 'PER_DART') return
    const idx = Math.min(2, dartCursor)
    let d: Dart
    if (dartMode === 'DB') d = { segment: 25, multiplier: 2 }
    else if (dartMode === 'SB') d = { segment: 25, multiplier: 1 }
    else if (dartMode === 'T') d = { segment: seg, multiplier: 3 }
    else if (dartMode === 'D') d = { segment: seg, multiplier: 2 }
    else d = { segment: seg, multiplier: 1 }

    const out = darts.map((x, i) => (i === idx ? d : x))
    setDarts(out)
    setDartCursor(Math.min(3, dartCursor + 1))
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="entryBar">
        <button
          className="entryToggle"
          onClick={() => {
            const next = entryMode === 'TOTAL' ? 'PER_DART' : 'TOTAL'
            setEntryMode(next)
            if (next === 'TOTAL') clear()
            else resetDarts()
          }}
          aria-label="Toggle input"
        >
          {entryMode === 'TOTAL' ? '123' : 'D'}
        </button>
        <div className="entryDisplay">
          <span className="entryHint">{entryMode === 'TOTAL' ? 'Enter a score' : labels.join('  ')}</span>
          <span className="entryScore">{entryMode === 'TOTAL' ? total : totalFromDarts}</span>
        </div>
        <button className="entrySubmit" onClick={onSubmit} disabled={!canSubmit}>
          Submit
        </button>
      </div>

      {entryMode === 'TOTAL' ? (
        <div className="col" style={{ gap: 10 }}>
          <div className="padGrid">
            {['1','2','3','4','5','6','7','8','9'].map((n) => (
              <button key={n} className="padKey" onClick={() => setDigit(n)}>
                {n}
              </button>
            ))}
            <button className="padKey padKeyAlt" onClick={clear}>Clear</button>
            <button className="padKey" onClick={() => setDigit('0')}>0</button>
            <button className="padKey padKeyDanger" onClick={backspace}>Undo</button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="multTabs">
            {([
              ['S', 'Single'],
              ['D', 'Double'],
              ['T', 'Treble'],
              ['DB', 'Bull 50'],
              ['SB', 'Outer 25'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                className={dartMode === k ? 'multTab multTabActive' : 'multTab'}
                onClick={() => setDartMode(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="segGrid">
            {Array.from({ length: 20 }, (_, idx) => idx + 1).map((n) => (
              <button key={n} className="padKey" onClick={() => applySegment(n)}>
                {n}
              </button>
            ))}
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={undoDart}>Undo dart</button>
            <button className="btn" onClick={miss}>Miss</button>
          </div>
        </div>
      )}
    </div>
  )
}

function dartPoints(d: Dart): number {
  if (d.multiplier === 0) return 0
  if (d.segment === 25) return d.multiplier === 2 ? 50 : 25
  return d.segment * d.multiplier
}

function dartToLabel(d: Dart): string {
  if (d.multiplier === 0) return 'MISS'
  if (d.segment === 25) return d.multiplier === 2 ? 'DB' : 'SB'
  if (d.multiplier === 3) return `T${d.segment}`
  if (d.multiplier === 2) return `D${d.segment}`
  return `${d.segment}`
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

function canSubmitForCurrent(code: string, currentPlayerId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const key = `dc_controlled_${code.toUpperCase()}`
    const ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    return ids.includes(currentPlayerId)
  } catch {
    return false
  }
}

function EnterTurnCard({
  currentPlayer,
  checkoutSuggestion,
  entryMode,
  setEntryMode,
  darts,
  setDarts,
  totalText,
  setTotalText,
  total,
  setTotal,
  needDarts,
  setNeedDarts,
  submitTurn,
  settings,
  finished,
  canSubmit,
}: {
  currentPlayer: Player | null
  checkoutSuggestion: { labels: string[] } | null
  entryMode: 'TOTAL' | 'PER_DART'
  setEntryMode: (m: 'TOTAL' | 'PER_DART') => void
  darts: Dart[]
  setDarts: (d: Dart[]) => void
  totalText: string
  setTotalText: (t: string) => void
  total: number
  setTotal: (n: number) => void
  needDarts: null | 'DOUBLE_IN'
  setNeedDarts: (v: null | 'DOUBLE_IN') => void
  submitTurn: (withDarts?: boolean) => Promise<void>
  settings: MatchSnapshot['settings'] | undefined
  finished: boolean
  canSubmit: boolean
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 16, marginBottom: 6 }}>Enter turn</div>
      <div className="help">
        {currentPlayer ? (
          <>Up: <b>{currentPlayer.name}</b></>
        ) : (
          <>Waiting for game to start...</>
        )}
      </div>

      {checkoutSuggestion ? (
        <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
          <span className="pill">Checkout</span>
          <span className="pill" style={{ color: 'var(--text)' }}>{checkoutSuggestion.labels.join('  ')}</span>
        </div>
      ) : null}

      <div className="col" style={{ marginTop: 10 }}>
        <div className="row">
          <button className="btn" onClick={() => setEntryMode('TOTAL')} disabled={entryMode === 'TOTAL'}>
            Total
          </button>
          <button className="btn" onClick={() => setEntryMode('PER_DART')} disabled={entryMode === 'PER_DART'}>
            3 darts
          </button>
        </div>

        {entryMode === 'PER_DART' ? (
          <PerDartEditor darts={darts} onChange={setDarts} />
        ) : (
          <div className="col">
            <label className="help">Total (0-180)</label>
            <input
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={totalText}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                setTotalText(v)
                const n = v === '' ? 0 : Number(v)
                if (Number.isFinite(n)) setTotal(Math.min(180, n))
              }}
            />

            <div className="mobileOnly">
              <NumberPad
                valueText={totalText}
                onChangeText={(v) => {
                  const next = v.replace(/[^0-9]/g, '').slice(0, 3)
                  setTotalText(next)
                  const n = next === '' ? 0 : Number(next)
                  if (Number.isFinite(n)) setTotal(Math.min(180, n))
                }}
                onEnter={() => submitTurn(false)}
              />
            </div>
            {needDarts ? (
              <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.18)' }}>
                <div className="help" style={{ marginBottom: 8 }}>
                  Double-in is enabled and you are not in yet; enter darts so the server can verify the double-in.
                </div>
                <PerDartEditor darts={darts} onChange={setDarts} />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={() => setNeedDarts(null)}>
                    Cancel
                  </button>
                  <button className="btn btnPrimary" onClick={() => submitTurn(true)}>
                    Submit with darts
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <button className="btn btnPrimary" onClick={() => submitTurn(false)} disabled={!settings || !currentPlayer || finished || !canSubmit}>
          Submit turn
        </button>
        {!finished && currentPlayer && !canSubmit ? <div className="help">Waiting for {currentPlayer.name} to submit.</div> : null}
      </div>
    </div>
  )
}

function PlayerPanel({
  player,
  isCurrent,
  leg,
  settings,
  match,
  stats,
}: {
  player: Player
  isCurrent: boolean
  leg: MatchSnapshot['leg'] | undefined
  settings: MatchSnapshot['settings'] | undefined
  match: MatchSnapshot | undefined
  stats: PlayerStats | undefined
}) {
  const ps = leg?.players?.find((x) => x.playerId === player.id)
  const last = lastScoreForPlayer(leg?.turns ?? [], player.id)
  const thrown = dartsThrownForPlayer(leg?.turns ?? [], player.id)

  return (
    <div className={isCurrent ? 'playerCard playerCardUp' : 'playerCard'}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="pill" style={{ color: 'var(--text)' }}>{player.name}</span>
          {isCurrent ? <span className="pill" style={{ color: 'rgba(0,0,0,0.82)', background: 'rgba(255,255,255,0.55)' }}>UP</span> : null}
          {settings?.doubleIn ? (
            <span className="pill" style={{ color: ps?.isIn ? 'var(--good)' : 'var(--muted)' }}>
              {ps?.isIn ? 'IN' : 'NOT IN'}
            </span>
          ) : null}
        </div>
        {match?.settings?.setsEnabled ? <span className="pill">Sets: {stats?.setsWon ?? 0}</span> : null}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
        <div className="playerBigNum playerBigNumDesktop">{ps?.remaining ?? '-'}</div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
          <span className="pill">Legs: {stats?.legsWon ?? 0}</span>
          <span className="pill">3-dart avg: {stats?.threeDartAvg ?? '-'}</span>
          <span className="pill">Last score: {last ?? '-'}</span>
          <span className="pill">Darts thrown: {thrown}</span>
        </div>
      </div>
    </div>
  )
}

function ScoresByPlayer({
  tab,
  turns,
  players,
  recentVisitsPerPlayer,
}: {
  tab: 'RECENT' | 'ALL'
  turns: MatchSnapshot['leg']['turns']
  players: Player[]
  recentVisitsPerPlayer: number
}) {
  if (!players || players.length === 0) return <div className="help">No players.</div>
  if (!turns || turns.length === 0) return <div className="help">No turns yet.</div>

  const byPlayerId: Record<string, MatchSnapshot['leg']['turns']> = {}
  for (const p of players) byPlayerId[p.id] = []
  for (const t of turns) {
    if (byPlayerId[t.playerId]) byPlayerId[t.playerId].push(t)
  }

  return (
    <div className="gridAuto">
      {players.map((p) => {
        const myTurns = byPlayerId[p.id] ?? []

        const visits = myTurns.map((t, idx) => {
          const visitNo = idx + 1
          return {
            id: t.id,
            dartsAfter: visitNo * 3,
            score: t.scoreTotal,
            remainingBefore: t.remainingBefore,
            remainingAfter: t.remainingAfter,
            isBust: t.isBust,
            didCheckout: t.didCheckout,
          }
        })

        const shown = tab === 'RECENT' ? visits.slice(-recentVisitsPerPlayer) : visits

        return (
          <div
            key={p.id}
            className="card"
            style={{ padding: 14, background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="pill" style={{ color: 'var(--text)' }}>{p.name}</span>
              <span className="pill">Visits: {visits.length}</span>
            </div>

            <div className="col" style={{ gap: 8, marginTop: 10 }}>
              {shown.length === 0 ? (
                <div className="help">No scores yet.</div>
              ) : (
                shown
                  .slice()
                  .reverse()
                  .map((v) => (
                    <div
                      key={v.id}
                      className="row"
                      style={{
                        justifyContent: 'space-between',
                        padding: 10,
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.10)',
                        background: v.isBust ? 'rgba(255,90,107,0.10)' : 'rgba(0,0,0,0.10)',
                      }}
                    >
                      <div className="row" style={{ flexWrap: 'wrap' }}>
                        <span className="pill">{v.dartsAfter} darts</span>
                        <span className="pill">{v.score}</span>
                        {v.isBust ? <span className="pill" style={{ color: 'var(--bad)' }}>BUST</span> : null}
                        {v.didCheckout ? <span className="pill" style={{ color: 'var(--good)' }}>OUT</span> : null}
                      </div>
                      <span className="pill">Rem: {v.remainingAfter}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

type DartKind = 'MISS' | 'S' | 'D' | 'T' | 'SB' | 'DB'

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

  if (isMobile) {
    return <MobilePerDartEditor darts={darts} onChange={onChange} />
  }

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
            <button
              key={i}
              className={active === i ? 'btn btnPrimary' : 'btn'}
              onClick={() => setActive(i as 0 | 1 | 2)}
            >
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
          <button className={kind === 'MISS' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('MISS')}>
            Miss
          </button>
          <button className={kind === 'S' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('S')}>
            Single
          </button>
          <button className={kind === 'D' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('D')}>
            Double
          </button>
          <button className={kind === 'T' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('T')}>
            Triple
          </button>
          <button className={kind === 'SB' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('SB')}>
            SB
          </button>
          <button className={kind === 'DB' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('DB')}>
            DB
          </button>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="segGrid">
            {Array.from({ length: 20 }, (_, idx) => idx + 1).map((n) => (
              <button
                key={n}
                className={n === current.segment ? 'key keyPrimary' : 'key'}
                onClick={() => setSegment(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn" onClick={() => setActive((a) => (a === 0 ? 0 : ((a - 1) as 0 | 1 | 2)))}>
          Back
        </button>
        <button className="btn btnPrimary" onClick={() => setActive((a) => (a === 2 ? 2 : ((a + 1) as 0 | 1 | 2)))}>
          Next
        </button>
      </div>
    </div>
  )
}

function NumberPad({
  valueText,
  onChangeText,
  onEnter,
  enterLabel,
}: {
  valueText: string
  onChangeText: (v: string) => void
  onEnter: () => void
  enterLabel?: string
}) {
  const enter = enterLabel ?? 'Enter'

  function append(d: string) {
    const next = (valueText + d).replace(/^0+(?=\d)/, '')
    onChangeText(next)
  }

  function backspace() {
    onChangeText(valueText.slice(0, -1))
  }

  function clear() {
    onChangeText('')
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="keypad">
        <button className="key" onClick={() => append('1')}>
          1
        </button>
        <button className="key" onClick={() => append('2')}>
          2
        </button>
        <button className="key" onClick={() => append('3')}>
          3
        </button>
        <button className="key" onClick={() => append('4')}>
          4
        </button>
        <button className="key" onClick={() => append('5')}>
          5
        </button>
        <button className="key" onClick={() => append('6')}>
          6
        </button>
        <button className="key" onClick={() => append('7')}>
          7
        </button>
        <button className="key" onClick={() => append('8')}>
          8
        </button>
        <button className="key" onClick={() => append('9')}>
          9
        </button>
        <button className="key keyDanger" onClick={clear}>
          Clear
        </button>
        <button className="key" onClick={() => append('0')}>
          0
        </button>
        <button className="key" onClick={backspace}>
          Bksp
        </button>
        <button className="key keyPrimary keyWide" onClick={onEnter}>
          {enter}
        </button>
      </div>
    </div>
  )
}
