'use client'

import { useMemo, useState } from 'react'

export default function DailyCheckoutCalendarPage() {
  const startKey = '2026-03-03'
  const startDate = useMemo(() => {
    const [y, m, d] = startKey.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }, [])
  const today = useMemo(() => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }, [])
  const todayKey = useMemo(() => toDateKey(today), [today])
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey)
  const [visibleMonth, setVisibleMonth] = useState(() => ({ year: today.getUTCFullYear(), month: today.getUTCMonth() }))

  const monthStart = new Date(Date.UTC(visibleMonth.year, visibleMonth.month, 1))
  const daysInMonth = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + 1, 0)).getUTCDate()
  const firstWeekday = monthStart.getUTCDay()
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const canGoNext =
    visibleMonth.year < today.getUTCFullYear() ||
    (visibleMonth.year === today.getUTCFullYear() && visibleMonth.month < today.getUTCMonth())
  const canGoPrev =
    visibleMonth.year > startDate.getUTCFullYear() ||
    (visibleMonth.year === startDate.getUTCFullYear() && visibleMonth.month > startDate.getUTCMonth())

  function goPrevMonth() {
    if (!canGoPrev) return
    const prev = new Date(Date.UTC(visibleMonth.year, visibleMonth.month - 1, 1))
    setVisibleMonth({ year: prev.getUTCFullYear(), month: prev.getUTCMonth() })
  }

  function goNextMonth() {
    if (!canGoNext) return
    const next = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + 1, 1))
    setVisibleMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() })
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 className="title">Daily Checkout</h1>
        <p className="subtitle">Pick a day, then play that checkout challenge.</p>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Calendar</div>
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn" onClick={goPrevMonth} disabled={!canGoPrev}>
              Prev
            </button>
            <span className="pill">
              {monthStart.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </span>
            <button className="btn" onClick={goNextMonth} disabled={!canGoNext}>
              Next
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
              <span key={w} className="help" style={{ textAlign: 'center' }}>
                {w}
              </span>
            ))}

            {cells.map((day, idx) => {
              if (day == null) return <div key={`blank-${idx}`} />
              const date = new Date(Date.UTC(visibleMonth.year, visibleMonth.month, day))
              const key = toDateKey(date)
              const isFuture = date.getTime() > today.getTime()
              const isBeforeStart = date.getTime() < startDate.getTime()
              const isToday = key === todayKey
              const isSelected = key === selectedDateKey

              return (
                <button
                  key={key}
                  className={isSelected ? 'btn btnPrimary' : 'btn'}
                  disabled={isFuture || isBeforeStart}
                  onClick={() => setSelectedDateKey(key)}
                  style={{
                    minHeight: 42,
                    opacity: isFuture || isBeforeStart ? 0.4 : 1,
                    borderColor: isToday ? 'var(--good)' : undefined,
                  }}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="pill">Selected: {selectedDateKey}</span>
            <span className="pill">Today: {todayKey}</span>
            <span className="pill">Starts: {startKey}</span>
          </div>

          <a className="btn btnPrimary" href={`/daily-checkout/${encodeURIComponent(selectedDateKey)}`}>
            Play this day
          </a>
          <div className="help">Pick any day up to today. Past days remain playable forever.</div>
        </div>
      </div>
    </div>
  )
}

function toDateKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
