import { io, type Socket } from 'socket.io-client'

type AckedSocket = Socket & {
  emitWithAck: (event: string, payload?: any, timeoutMs?: number) => Promise<any>
}

let socketSingleton: AckedSocket | null = null
let socketUrl: string | null = null

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
        resolve(res)
      })
    })
  }

  socketSingleton = s
  socketUrl = url
  return s
}
