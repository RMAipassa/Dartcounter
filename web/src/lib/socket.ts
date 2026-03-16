import { io, type Socket } from 'socket.io-client'

type AckedSocket = Socket & {
  emitWithAck: (event: string, payload?: any, timeoutMs?: number) => Promise<any>
}

let socketSingleton: AckedSocket | null = null
let socketUrl: string | null = null
let unloadHooked = false
let authExpiredNotifiedAt = 0

function handleAuthInvalidIfNeeded(res: any): void {
  if (typeof window === 'undefined') return
  if (!res || typeof res !== 'object') return
  if (res.ok !== false || res.code !== 'AUTH_INVALID') return

  try {
    localStorage.removeItem('dc_authToken')
    localStorage.removeItem('dc_authDisplayName')
  } catch {
    // ignore storage issues
  }

  const now = Date.now()
  if (now - authExpiredNotifiedAt < 1200) return
  authExpiredNotifiedAt = now
  window.dispatchEvent(new CustomEvent('dc:authExpired'))
}

export function getSocket(url: string): AckedSocket {
  if (socketSingleton && socketUrl === url) return socketSingleton

  const s = io(url, {
    transports: ['websocket'],
    autoConnect: true,
  }) as AckedSocket

  s.emitWithAck = (event: string, payload?: any, timeoutMs = 6000) => {
    return new Promise((resolve) => {
      let done = false
      const t = setTimeout(() => {
        if (done) return
        done = true
        resolve({ ok: false, code: 'TIMEOUT', message: 'Request timed out' })
      }, timeoutMs)

      s.emit(event, payload, (res: any) => {
        if (done) return
        done = true
        clearTimeout(t)
        handleAuthInvalidIfNeeded(res)
        resolve(res)
      })
    })
  }

  socketSingleton = s
  socketUrl = url

  if (typeof window !== 'undefined' && !unloadHooked) {
    unloadHooked = true
    window.addEventListener('beforeunload', () => {
      try {
        socketSingleton?.close()
      } catch {
        // ignore
      }
    })
  }
  return s
}
