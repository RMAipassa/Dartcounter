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
  socketSingleton?.close()

  const s = io(url, {
    transports: ['websocket'],
    autoConnect: true,
  }) as AckedSocket

  s.emitWithAck = (event: string, payload?: any, timeoutMs = 6000) => {
    return new Promise((resolve) => {
      // Socket.IO also removes unsent packets when their acknowledgement expires.
      // A disconnected scorer must not send a stale visit after it has timed out.
      s.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: any) => {
        if (err) {
          resolve({ ok: false, code: 'TIMEOUT', message: 'No response from the server. Check the scoreboard before retrying.' })
          return
        }
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
