'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 520px)').matches
  })

  const hostSecret = typeof window !== 'undefined' ? localStorage.getItem('dc_hostSecret') : null
  const wakeLockRef = useRef<any>(null)

  const canFullscreen = useMemo(() => {
    if (typeof document === 'undefined') return false
    return Boolean((document.documentElement as any)?.requestFullscreen)
  }, [])

  useEffect(() => {
    setServerUrl(getServerUrl())

    const mq = window.matchMedia('(max-width: 520px)')
    const onChange = () => setIsMobile(Boolean(mq.matches))
    onChange()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  useEffect(() => {
    const m = pathname.match(/^\/room\/([^/]+)\/(lobby|game)/i)
    setRoomCode(m ? m[1].toUpperCase() : null)
  }, [pathname, isMobile])

  const hideTopbar = isMobile && Boolean(pathname.match(/^\/room\/[^/]+\/game/i))

  useEffect(() => {
    function onOpenMenu() {
      setOpen(true)
    }
    window.addEventListener('dc:openMenu', onOpenMenu as any)
    return () => window.removeEventListener('dc:openMenu', onOpenMenu as any)
  }, [])

  useEffect(() => {
    function onBip(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ((window.navigator as any).standalone === true)
    if (!isStandalone) return

    let cancelled = false

    async function requestWakeLock() {
      try {
        if (cancelled) return
        const nav: any = navigator
        if (!nav?.wakeLock?.request) return
        const lock = await nav.wakeLock.request('screen')
        if (cancelled) {
          try {
            await lock.release()
          } catch {
            // ignore
          }
          return
        }
        wakeLockRef.current = lock
        lock.addEventListener?.('release', () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null
        })
      } catch {
        // Wake Lock may be unsupported or denied.
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        void requestWakeLock()
      }
    }

    void requestWakeLock()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (wakeLockRef.current) {
        void wakeLockRef.current.release().catch(() => undefined)
        wakeLockRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!serverUrl) return
    const socket = getSocket(serverUrl)

    function identifyNow() {
      const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
      if (!token) return
      void socket.emitWithAck('social:identify', { authToken: token, token })
    }

    identifyNow()

    function onConnect() {
      identifyNow()
    }

    const identifyTimer = window.setInterval(() => identifyNow(), 20_000)

    function onChallengeInvite(evt: any) {
      const challengeId = String(evt?.challengeId ?? '')
      const fromName = String(evt?.from?.displayName ?? 'A friend')
      if (!challengeId) return

      const accept = window.confirm(`${fromName} challenged you to a match. Accept now?`)
      const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
      void socket.emitWithAck('friends:challengeRespond', { challengeId, accept, authToken: token ?? undefined }).then((res: any) => {
        if (!res?.ok && accept) {
          setToast(res?.message ?? 'Could not accept challenge')
          setTimeout(() => setToast(null), 2500)
        }
      })
    }

    function onFriendRequestReceived(evt: any) {
      const fromName = String(evt?.from?.displayName ?? 'Someone')
      setToast(`${fromName} sent you a friend request.`)
      setTimeout(() => setToast(null), 2200)
    }

    function onChallengeResolved(evt: any) {
      if (evt?.accepted === false) {
        setToast('Challenge declined.')
        setTimeout(() => setToast(null), 1800)
      }
    }

    function onChallengeMatchReady(evt: any) {
      const roomCode = String(evt?.roomCode ?? '').toUpperCase()
      const hostSecretIncoming = typeof evt?.hostSecret === 'string' ? evt.hostSecret : null
      if (!roomCode) return

      if (hostSecretIncoming) localStorage.setItem('dc_hostSecret', hostSecretIncoming)
      localStorage.setItem('dc_role', 'PLAYER')
      setToast('Challenge accepted. Joining lobby...')
      setTimeout(() => setToast(null), 1600)
      window.location.href = `/room/${roomCode}/lobby`
    }

    socket.on('friends:challengeInvite', onChallengeInvite)
    socket.on('friends:requestReceived', onFriendRequestReceived)
    socket.on('friends:challengeResolved', onChallengeResolved)
    socket.on('friends:challengeMatchReady', onChallengeMatchReady)
    socket.on('connect', onConnect)

    return () => {
      window.clearInterval(identifyTimer)
      socket.off('friends:challengeInvite', onChallengeInvite)
      socket.off('friends:requestReceived', onFriendRequestReceived)
      socket.off('friends:challengeResolved', onChallengeResolved)
      socket.off('friends:challengeMatchReady', onChallengeMatchReady)
      socket.off('connect', onConnect)
    }
  }, [serverUrl])

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

  async function leaveRoom() {
    try {
      const socket = getSocket(serverUrl)
      await socket.emitWithAck('room:leave')
    } catch {
      // ignore
    }
    localStorage.setItem('dc_role', 'SPECTATOR')
    window.location.href = '/'
  }

  async function undoLastTurn() {
    try {
      if (!hostSecret) throw new Error('Host secret missing on this device')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('game:undoLastTurn', { hostSecret })
      if (!res?.ok) throw new Error(res?.message ?? 'Undo failed')
      setToast('Undid last turn.')
      setTimeout(() => setToast(null), 1500)
    } catch (e: any) {
      setToast(e?.message ?? 'Undo failed')
      setTimeout(() => setToast(null), 2500)
    }
  }

  async function copyRoomCode() {
    try {
      if (!roomCode) return
      await navigator.clipboard.writeText(roomCode)
      setToast('Copied room code.')
      setTimeout(() => setToast(null), 1200)
    } catch {
      setToast('Copy not supported.')
      setTimeout(() => setToast(null), 2000)
    }
  }

  return (
    <div>
      {!hideTopbar ? (
        <div className="topbar">
          <a className="brand" href="/">
            Dartcounter
          </a>
          <button className="btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            Menu
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          className="menuOverlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="menuPanel card" style={{ padding: 12 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="pill">Menu</span>
              <button className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            {roomCode ? (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span className="pill">Room: {roomCode}</span>
                <button
                  className="btn"
                  onClick={() => {
                    copyRoomCode()
                    setOpen(false)
                  }}
                >
                  Copy code
                </button>
              </div>
            ) : null}

            <div className="col" style={{ marginTop: 10 }}>
              <a className="btn" href="/" onClick={() => setOpen(false)}>
                Home
              </a>
              <a className="btn" href="/lobbies" onClick={() => setOpen(false)}>
                Public lobbies
              </a>
              <a className="btn" href="/account" onClick={() => setOpen(false)}>
                Account
              </a>
              {roomCode ? (
                <button
                  className="btn"
                  onClick={() => {
                    setOpen(false)
                    leaveRoom()
                  }}
                >
                  Leave room
                </button>
              ) : null}
              {roomCode && hostSecret ? (
                <button
                  className="btn"
                  onClick={() => {
                    setOpen(false)
                    undoLastTurn()
                  }}
                >
                  Undo last turn
                </button>
              ) : null}
              <button
                className={deferredPrompt ? 'btn btnPrimary' : 'btn'}
                onClick={() => {
                  setOpen(false)
                  install()
                }}
              >
                Install app
              </button>
              <button
                className="btn"
                onClick={() => {
                  setOpen(false)
                  toggleFullscreen()
                }}
              >
                Fullscreen
              </button>
              <div className="help">Best fullscreen: use Install (Add to Home Screen).</div>
            </div>
          </div>
        </div>
      ) : null}

      {children}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
