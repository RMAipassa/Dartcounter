import type { ReactNode } from 'react'

export function NameMark({ name }: { name: string }) {
  const words = name.trim().split(/\s+/)
  const initials = [words[0], ...(words.length > 1 ? [words[words.length - 1]] : [])]
    .map((word) => [...word][0] ?? '').join('').toUpperCase()
  return <span className="nameMark" aria-hidden="true">{initials || '•'}</span>
}

export default function NameRow({ name, detail, badge, marker, actions }: {
  name: string
  detail?: ReactNode
  badge?: ReactNode
  marker?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="nameRow">
      {marker ?? <NameMark name={name} />}
      <div className="nameRowText">
        <div className="nameRowTitle"><strong>{name}</strong>{badge}</div>
        {detail ? <div className="help">{detail}</div> : null}
      </div>
      {actions ? <div className="nameRowActions">{actions}</div> : null}
    </div>
  )
}
