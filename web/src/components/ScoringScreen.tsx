'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import Icon from './Icon'

export const ScoringMenuContext = createContext<{
  target: HTMLElement | null
  open: boolean
  show: () => void
  undo: (() => Promise<void>) | null
  undoing: boolean
} | null>(null)

export function ScoringHeader({ title, detail, back, backLabel, compact, actions }: {
  title: string; detail?: string; back: string; backLabel: string; compact?: boolean; actions?: ReactNode
}) {
  const menu = useContext(ScoringMenuContext)
  return (
    <header className="scoringHeader" data-compact={compact}>
      <Link href={back} className="btn scoringBack" aria-label={backLabel}><Icon name="arrow" /></Link>
      <div className="scoringHeading"><h1>{title}</h1>{detail ? <p>{detail}</p> : null}</div>
      <div className="scoringHeaderActions">
        {actions}
        <button type="button" className="btn scoringMenuTrigger" onClick={menu?.show} aria-haspopup="dialog" aria-expanded={menu?.open} aria-label="Game menu"><Icon name={compact ? 'sliders' : 'menu'} /> <span>Menu</span></button>
      </div>
    </header>
  )
}

export function ScoringMenu({ children }: { children: ReactNode }) {
  const menu = useContext(ScoringMenuContext)
  return menu?.open && menu.target ? createPortal(children, menu.target) : null
}

export function ScoringMenuSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="card scoringMenuSection">
      <summary>{title}{hint ? <> <small>{hint}</small></> : null}</summary>
      <div className="col scoringMenuBody">{children}</div>
    </details>
  )
}
