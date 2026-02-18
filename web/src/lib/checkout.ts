import type { Dart } from './types'

export type OutRule = 'ANY' | 'DOUBLE' | 'MASTER'

export type CheckoutSuggestion = {
  darts: Dart[]
  labels: string[]
}

function dartPoints(d: Dart): number {
  if (d.multiplier === 0) return 0
  if (d.segment === 25) return d.multiplier === 2 ? 50 : 25
  return d.segment * d.multiplier
}

function dartLabel(d: Dart): string {
  if (d.segment === 25) return d.multiplier === 2 ? 'DB' : 'SB'
  if (d.multiplier === 3) return `T${d.segment}`
  if (d.multiplier === 2) return `D${d.segment}`
  return `${d.segment}`
}

function isFinishingDart(d: Dart, outRule: OutRule): boolean {
  if (outRule === 'DOUBLE') return d.multiplier === 2
  if (outRule === 'MASTER') return d.multiplier === 2 || d.multiplier === 3
  return true
}

function allDarts(): Dart[] {
  const out: Dart[] = []
  for (let seg = 1; seg <= 20; seg++) {
    out.push({ segment: seg, multiplier: 1 })
    out.push({ segment: seg, multiplier: 2 })
    out.push({ segment: seg, multiplier: 3 })
  }
  out.push({ segment: 25, multiplier: 1 })
  out.push({ segment: 25, multiplier: 2 })
  return out
}

const FINISH_PREF: Dart[] = [
  { segment: 20, multiplier: 2 },
  { segment: 16, multiplier: 2 },
  { segment: 18, multiplier: 2 },
  { segment: 12, multiplier: 2 },
  { segment: 10, multiplier: 2 },
  { segment: 8, multiplier: 2 },
  { segment: 6, multiplier: 2 },
  { segment: 4, multiplier: 2 },
  { segment: 2, multiplier: 2 },
  { segment: 25, multiplier: 2 },
]

function finishPrefIndex(d: Dart): number {
  const idx = FINISH_PREF.findIndex((x) => x.segment === d.segment && x.multiplier === d.multiplier)
  return idx === -1 ? 999 : idx
}

export function suggestCheckout(args: {
  remaining: number
  outRule: OutRule
  maxDarts?: 3 | 2 | 1
}): CheckoutSuggestion | null {
  const remaining = args.remaining
  if (!Number.isFinite(remaining) || remaining <= 1) return null

  const maxDarts = args.maxDarts ?? 3
  const outRule = args.outRule
  const darts = allDarts()
  const results: Dart[][] = []

  function dfs(need: number, left: number, path: Dart[]) {
    if (left === 0) {
      if (need === 0) results.push(path)
      return
    }
    if (need <= 0) return

    for (const d of darts) {
      const pts = dartPoints(d)
      if (pts > need) continue

      if (left === 1) {
        if (pts !== need) continue
        if (!isFinishingDart(d, outRule)) continue
        results.push([...path, d])
        continue
      }

      dfs(need - pts, left - 1, [...path, d])
    }
  }

  for (let n = 1; n <= maxDarts; n++) dfs(remaining, n, [])
  if (results.length === 0) return null

  results.sort((a, b) => {
    // 1) fewer darts
    if (a.length !== b.length) return a.length - b.length

    // 2) prefer good doubles
    const af = a[a.length - 1]
    const bf = b[b.length - 1]
    const ap = finishPrefIndex(af)
    const bp = finishPrefIndex(bf)
    if (ap !== bp) return ap - bp

    // 3) prefer higher early scoring
    const av0 = dartPoints(a[0])
    const bv0 = dartPoints(b[0])
    if (av0 !== bv0) return bv0 - av0
    const av1 = a[1] ? dartPoints(a[1]) : 0
    const bv1 = b[1] ? dartPoints(b[1]) : 0
    if (av1 !== bv1) return bv1 - av1

    // 4) stable
    return 0
  })

  const best = results[0]
  return {
    darts: best,
    labels: best.map(dartLabel),
  }
}
