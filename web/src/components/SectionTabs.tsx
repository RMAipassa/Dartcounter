'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

type Tab<T> = { id: T; label: string; count?: number }

export function SectionTabs<T extends string>({ group, label, tabs, active, onChange }: {
  group: string
  label: string
  tabs: readonly Tab<T>[]
  active: T
  onChange: (tab: T) => void
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<T, HTMLButtonElement>())

  function activate(id: T) {
    onChange(id)
    const marker = anchor.current
    if (marker && marker.getBoundingClientRect().top < 0) marker.scrollIntoView({ block: 'start' })
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + last) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
    if (next === null) return
    event.preventDefault()
    const id = tabs[next].id
    buttons.current.get(id)?.focus({ preventScroll: true })
    activate(id)
  }

  return (
    <>
      <div ref={anchor} className="sectionTabsAnchor" aria-hidden="true" />
      <div className="sectionTabs" role="tablist" aria-label={label}>
        {tabs.map(({ id, label: title, count }, index) => (
          <button key={id} type="button" role="tab" id={`${group}-tab-${id}`} aria-controls={`${group}-panel-${id}`}
            aria-selected={active === id} tabIndex={active === id ? 0 : -1}
            ref={(el) => { if (el) buttons.current.set(id, el); else buttons.current.delete(id) }}
            onClick={() => activate(id)} onKeyDown={(event) => onKeyDown(event, index)}>
            {title}{count ? <span className="sectionTabCount" aria-label={`${count} pending`}>{count}</span> : null}
          </button>
        ))}
      </div>
    </>
  )
}

export function SectionPanel({ group, id, active, children, labelledBy }: { group: string; id: string; active: string; children: ReactNode; labelledBy?: string }) {
  return (
    <div className="col sectionPanel" role="tabpanel" id={`${group}-panel-${id}`} aria-labelledby={labelledBy ?? `${group}-tab-${id}`} hidden={id !== active} tabIndex={0}>
      {children}
    </div>
  )
}
