'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type { Dart, RoomSnapshot } from '@/lib/types'

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

  const [needDarts, setNeedDarts] = useState<null | 'CHECKOUT' | 'DOUBLE_IN'>(null)

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
        if (res?.code === 'NEED_DARTS_FOR_CHECKOUT') setNeedDarts('CHECKOUT')
        else if (res?.code === 'NEED_DARTS_FOR_DOUBLE_IN') setNeedDarts('DOUBLE_IN')
        throw new Error(res?.message ?? 'Failed')
      }
      setNeedDarts(null)
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    }
  }

  async function undo() {
    try {
      if (!hostSecret) throw new Error('Host secret not found on this device')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('game:undoLastTurn', { hostSecret })
      if (!res?.ok) throw new Error(res?.message ?? 'Failed')
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Game</h1>
          <p className="subtitle">
            Room <span className="pill">{code}</span>{' '}
            {settings ? (
              <span className="pill">
                {settings.startScore} · {settings.doubleIn ? 'DI' : 'SI'} · {settings.doubleOut ? 'DO' : settings.masterOut ? 'MO' : 'SO'}
              </span>
            ) : null}
          </p>
        </div>
        <div className="row">
          <a className="btn" href={`/room/${code}/lobby`}>
            Lobby
          </a>
          <button className="btn" onClick={undo} disabled={!hostSecret}>
            Undo
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 16, marginBottom: 6 }}>Scoreboard</div>
              <div className="help">Current player highlights; remaining includes bust rules.</div>
            </div>
            {finished ? <span className="pill" style={{ color: 'var(--good)' }}>Match finished</span> : null}
          </div>

          <div className="col" style={{ marginTop: 10 }}>
            {players.map((p) => {
              const ps = leg?.players?.find((x) => x.playerId === p.id)
              const isCurrent = p.id === currentPlayer?.id
              return (
                <div
                  key={p.id}
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    padding: 12,
                    borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: isCurrent ? 'rgba(125, 211, 252, 0.14)' : 'rgba(0,0,0,0.14)',
                  }}
                >
                  <div className="row">
                    <span className="pill" style={{ color: 'var(--text)' }}>{p.name}</span>
                    {settings?.doubleIn ? (
                      <span className="pill" style={{ color: ps?.isIn ? 'var(--good)' : 'var(--muted)' }}>
                        {ps?.isIn ? 'IN' : 'NOT IN'}
                      </span>
                    ) : null}
                  </div>
                  <div className="row">
                    <span className="pill" style={{ color: 'var(--text)' }}>Rem: {ps?.remaining ?? '-'}</span>
                    <span className="pill">Turns: {ps?.turnsTaken ?? 0}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 6 }}>Enter turn</div>
          <div className="help">
            {currentPlayer ? (
              <>Up: <b>{currentPlayer.name}</b></>
            ) : (
              <>Waiting for game to start...</>
            )}
          </div>

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
                      {needDarts === 'CHECKOUT'
                        ? 'This looks like a checkout; enter darts so the server can verify the finishing dart.'
                        : 'Double-in is enabled and you are not in yet; enter darts so the server can verify the double-in.'}
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

            <button className="btn btnPrimary" onClick={() => submitTurn(false)} disabled={!settings || !currentPlayer || finished}>
              Submit turn
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, marginBottom: 6 }}>Turns</div>
            <div className="help">Newest last.</div>
          </div>
          {leg?.winnerPlayerId ? (
            <span className="pill" style={{ color: 'var(--good)' }}>
              Leg winner: {players.find((p) => p.id === leg.winnerPlayerId)?.name ?? leg.winnerPlayerId}
            </span>
          ) : null}
        </div>

        <div className="col" style={{ marginTop: 10 }}>
          {(leg?.turns ?? []).length === 0 ? <div className="help">No turns yet.</div> : null}
          {(leg?.turns ?? []).map((t) => {
            const p = players.find((x) => x.id === t.playerId)
            return (
              <div
                key={t.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  padding: 10,
                  borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: t.isBust ? 'rgba(255,90,107,0.10)' : 'rgba(0,0,0,0.12)',
                }}
              >
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="pill" style={{ color: 'var(--text)' }}>{p?.name ?? t.playerId}</span>
                  <span className="pill">Scored: {t.scoreTotal}</span>
                  {t.isBust ? <span className="pill" style={{ color: 'var(--bad)' }}>BUST</span> : null}
                  {t.didCheckout ? <span className="pill" style={{ color: 'var(--good)' }}>CHECKOUT</span> : null}
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="pill">{t.remainingBefore} → {t.remainingAfter}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

function PerDartEditor({ darts, onChange }: { darts: Dart[]; onChange: (d: Dart[]) => void }) {
  function setDart(i: number, patch: Partial<Dart>) {
    const next = darts.map((d, idx) => (idx === i ? { ...d, ...patch } : d))
    onChange(next)
  }

  const [active, setActive] = useState<number>(0)
  const activeDart = darts[active] ?? { segment: 0, multiplier: 0 }

  function setActiveSegmentText(txt: string) {
    const v = txt.replace(/[^0-9]/g, '').slice(0, 2)
    const n = v === '' ? 0 : Number(v)
    if (!Number.isFinite(n)) return
    // allow 0-20 and 25
    const clamped = n === 25 ? 25 : Math.max(0, Math.min(20, n))
    setDart(active, { segment: clamped })
  }

  return (
    <div className="col">
      <div className="help">Darts (segment 0-20, or 25. multiplier 0/1/2/3; miss is 0x0)</div>

      <div className="mobileOnly">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="pill">Editing dart {active + 1}</span>
          <div className="row">
            {[0, 1, 2].map((i) => (
              <button key={i} className="btn" onClick={() => setActive(i)} disabled={active === i}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="pill">Segment: {activeDart.segment}</span>
          <span className="pill">Mult: x{activeDart.multiplier}</span>
        </div>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          {[0, 1, 2, 3].map((m) => (
            <button
              key={m}
              className="btn"
              onClick={() => setDart(active, { multiplier: m as any })}
              disabled={activeDart.multiplier === m}
            >
              x{m}
            </button>
          ))}
          <button className="btn" onClick={() => setDart(active, { segment: 25, multiplier: 1 })}>
            Bull 25
          </button>
          <button className="btn" onClick={() => setDart(active, { segment: 25, multiplier: 2 })}>
            Bull 50
          </button>
        </div>

        <NumberPad
          valueText={String(activeDart.segment)}
          onChangeText={setActiveSegmentText}
          onEnter={() => setActive((a) => Math.min(2, a + 1))}
          enterLabel="Next"
        />

        <hr className="hr" />
      </div>

      <div className="grid2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
            <div className="help" style={{ marginBottom: 8 }}>Dart {i + 1}</div>
            <div className="row">
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={darts[i]?.segment ?? 0}
                onChange={(e) => setDart(i, { segment: Number(e.target.value) })}
                placeholder="20"
              />
              <select
                className="select"
                value={darts[i]?.multiplier ?? 0}
                onChange={(e) => setDart(i, { multiplier: Number(e.target.value) as any })}
              >
                <option value={0}>x0</option>
                <option value={1}>x1</option>
                <option value={2}>x2</option>
                <option value={3}>x3</option>
              </select>
            </div>
          </div>
        ))}
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
