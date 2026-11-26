'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from './Icon'

export default function ResumeMatch() {
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('dc_activeMatch')
    if (saved && /^[A-Z0-9]{6}$/.test(saved)) setCode(saved)
  }, [])

  return code ? <Link className="btn" href={`/room/${code}/game`}><Icon name="arrow" /> Resume match · {code}</Link> : null
}
