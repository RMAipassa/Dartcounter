'use client'

import { useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  const canFullscreen = useMemo(() => {
    if (typeof document === 'undefined') return false
    return Boolean((document.documentElement as any)?.requestFullscreen)
  }, [])

  useEffect(() => {
    function onBip(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  async function install() {
    try {
      if (!deferredPrompt) {
        setToast(
          'Install: iPhone Safari → Share → Add to Home Screen. Android Chrome → Install app / Add to Home screen.',
        )
        setTimeout(() => setToast(null), 4500)
        return
      }
      await deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
      setToast('Install prompt opened.')
      setTimeout(() => setToast(null), 2000)
    } catch {
      setToast('Install not available in this browser.')
      setTimeout(() => setToast(null), 2500)
    }
  }

  async function toggleFullscreen() {
    try {
      const doc: any = document
      if (doc.fullscreenElement) {
        await doc.exitFullscreen()
        return
      }
      const el: any = document.documentElement
      if (el.requestFullscreen) await el.requestFullscreen()
      else {
        setToast('Fullscreen not supported on this device/browser.')
        setTimeout(() => setToast(null), 2500)
      }
    } catch {
      setToast('Fullscreen blocked by browser.')
      setTimeout(() => setToast(null), 2500)
    }
  }

  return (
    <div>
      <div className="topbar">
        <a className="brand" href="/">
          Dartcounter
        </a>
        <button className="btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          Menu
        </button>
      </div>

      {open ? (
        <div className="menu card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <a className="btn" href="/" onClick={() => setOpen(false)}>
              Home
            </a>
            <a className="btn" href="/lobbies" onClick={() => setOpen(false)}>
              Public lobbies
            </a>
            <button
              className={deferredPrompt ? 'btn btnPrimary' : 'btn'}
              onClick={() => {
                setOpen(false)
                install()
              }}
            >
              Install
            </button>
            <button
              className={canFullscreen ? 'btn' : 'btn'}
              onClick={() => {
                setOpen(false)
                toggleFullscreen()
              }}
            >
              Fullscreen
            </button>
          </div>
          <div className="help" style={{ marginTop: 8 }}>
            Best fullscreen: use Install (Add to Home Screen).
          </div>
        </div>
      ) : null}

      {children}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
