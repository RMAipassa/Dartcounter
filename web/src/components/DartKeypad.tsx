'use client'

import { useEffect, useState } from 'react'
import type { Dart } from '@/lib/types'

function dartLabel(dart: Dart) {
  if (!dart.multiplier) return 'Miss'
  if (dart.segment === 25) return dart.multiplier === 2 ? 'Bull' : 'Outer bull'
  return `${dart.multiplier === 3 ? 'T' : dart.multiplier === 2 ? 'D' : ''}${dart.segment}`
}

export default function DartKeypad({ darts, onChange, revision, reviewDarts }: {
  darts: Dart[]
  onChange: (darts: Dart[]) => void
  revision: number
  reviewDarts?: Dart[] | null
}) {
  const [multiplier, setMultiplier] = useState<1 | 2 | 3>(1)
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    setCursor(0)
    setMultiplier(1)
  }, [revision, reviewDarts])

  function replaceDart(index: number, dart: Dart) {
    onChange(darts.map((previous, i) => i === index ? dart : previous))
  }

  function record(dart: Dart) {
    if (cursor >= darts.length) return
    replaceDart(cursor, dart)
    setCursor(cursor + 1)
    setMultiplier(1)
  }

  const full = cursor >= darts.length

  return (
    <div className="dartKeypad">
      <div className="dartSlots" role="group" aria-label="Select a dart to edit">
        {darts.map((dart, index) => <button key={index} type="button" className="btn" aria-pressed={cursor === index} onClick={() => setCursor(index)}>Dart {index + 1}: {dartLabel(dart)}</button>)}
      </div>
      <div className="multTabs" role="group" aria-label="Dart multiplier">
        {([[1, 'Single'], [2, 'Double'], [3, 'Treble']] as const).map(([value, label]) => (
          <button key={value} type="button" className="multTab" aria-pressed={multiplier === value} onClick={() => setMultiplier(value)}>{label}</button>
        ))}
      </div>
      <div className="segGrid" role="group" aria-label="Dart segment">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((segment) => (
          <button key={segment} type="button" className="padKey" disabled={full} onClick={() => record({ segment, multiplier })}>{segment}</button>
        ))}
      </div>
      <div className="dartActions">
        <button className="btn" type="button" disabled={full} onClick={() => record({ segment: 25, multiplier: 2 })}>Bull 50</button>
        <button className="btn" type="button" disabled={full} onClick={() => record({ segment: 25, multiplier: 1 })}>Outer 25</button>
        <button className="btn" type="button" disabled={full} onClick={() => record({ segment: 0, multiplier: 0 })}>Miss</button>
        <button className="btn" type="button" disabled={cursor === 0} onClick={() => {
          const previous = cursor - 1
          replaceDart(previous, { segment: 0, multiplier: 0 })
          setCursor(previous)
        }}>Undo dart</button>
      </div>
    </div>
  )
}
