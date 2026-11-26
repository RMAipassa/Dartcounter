import { getSocket } from './socket'
import type { RoomSnapshot } from './types'

export function hostSecretForRoom(code: string): string | null {
  return localStorage.getItem(`dc_hostSecret_${code.toUpperCase()}`)
}

export function rememberHostSecret(code: string, secret: string) {
  const key = `dc_hostSecret_${code.toUpperCase()}`
  if (localStorage.getItem(key) === secret) return
  localStorage.setItem(key, secret)
  window.dispatchEvent(new Event('dc:hostSecretChanged'))
}

export function roomDeviceKey() {
  const existing = localStorage.getItem('dc_roomDeviceKey')
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing
  const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  localStorage.setItem('dc_roomDeviceKey', key)
  return key
}

export function hostProofsForBrowser() {
  const proofs: Array<{ code: string; hostSecret: string }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const code = localStorage.key(i)?.match(/^dc_hostSecret_([A-Z0-9]{6})$/)?.[1]
    if (!code) continue
    const hostSecret = hostSecretForRoom(code)
    if (hostSecret) proofs.push({ code, hostSecret })
  }
  return proofs.slice(0, 2048)
}

export function rememberRoomIdentity(code: string, name: string, role: 'PLAYER' | 'SPECTATOR') {
  localStorage.setItem(`dc_roomName_${code.toUpperCase()}`, name)
  rememberRoomRole(code, role)
}

export function rememberRoomRole(code: string, role: 'PLAYER' | 'SPECTATOR') {
  localStorage.setItem(`dc_roomRole_${code.toUpperCase()}`, role)
}

export function rememberActiveMatch(snapshot: RoomSnapshot) {
  if (snapshot.match.settings.gameType === 'PRACTICE') return
  if (snapshot.match.status === 'LIVE') {
    localStorage.setItem('dc_activeMatch', snapshot.code)
  } else if (localStorage.getItem('dc_activeMatch') === snapshot.code) {
    localStorage.removeItem('dc_activeMatch')
  }
}

export function subscribeToRoom(
  socket: ReturnType<typeof getSocket>,
  code: string,
  onConnection: (connected: boolean) => void,
  onJoinError: (message: string) => void,
) {
  let active = true

  async function join() {
    const id = socket.id
    const authToken = localStorage.getItem('dc_authToken') || undefined
    const name = (authToken && localStorage.getItem('dc_authDisplayName')) || localStorage.getItem(`dc_roomName_${code}`) || localStorage.getItem('dc_name') || 'Guest'
    const role = localStorage.getItem(`dc_roomRole_${code}`)
    const res = await socket.emitWithAck('room:join', {
      code, name, hostSecret: hostSecretForRoom(code) ?? undefined, authToken, asSpectator: role === 'SPECTATOR', deviceKey: roomDeviceKey(),
    })
    if (!active || socket.id !== id || !socket.connected) return
    if (res?.ok) {
      if (res.hostSecret) rememberHostSecret(code, res.hostSecret)
      rememberRoomIdentity(code, name, res.role === 'PLAYER' ? 'PLAYER' : 'SPECTATOR')
      onConnection(true)
    } else {
      onJoinError(res?.message ?? 'Could not rejoin this match.')
    }
  }

  function onDisconnect() { onConnection(false) }

  socket.on('connect', join)
  socket.on('disconnect', onDisconnect)
  if (socket.connected) void join()
  return () => {
    active = false
    socket.off('connect', join)
    socket.off('disconnect', onDisconnect)
  }
}
