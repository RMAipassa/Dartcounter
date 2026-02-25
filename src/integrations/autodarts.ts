import { EventEmitter } from 'events'
import type { Dart } from '../game/types'

export type AutodartsMockMode = 'MANUAL' | 'AUTO'
export type AutodartsRuntimeMode = 'MOCK' | 'REAL'
export type AutodartsConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'

export type AutodartsRoomState = {
  roomCode: string
  deviceId: string | null
  runtimeMode: AutodartsRuntimeMode
  status: AutodartsConnectionStatus
  mockMode: AutodartsMockMode | null
  lastConnectedAt: number | null
  lastEventAt: number | null
  lastError: string | null
}

export type AutodartsDartEvent = {
  roomCode: string
  deviceId: string
  source: 'MOCK_MANUAL' | 'MOCK_AUTO' | 'REAL'
  createdAt: number
  dart: Dart
}

type StateEvent = {
  roomCode: string
  state: AutodartsRoomState
}

type AdapterStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'

type AdapterStatusPayload = {
  status: AdapterStatus
  error?: string
}

type AutodartsAdapter = {
  connect: (args: { deviceId: string }) => Promise<void>
  disconnect: () => Promise<void>
  onStatus: (cb: (payload: AdapterStatusPayload) => void) => () => void
  onDart: (cb: (dart: Dart) => void) => () => void
}

type MockAdapterOptions = {
  enabled: boolean
  connectDelayMs: number
  autoDartIntervalMs: number
  mockMode: AutodartsMockMode
}

type RealAdapterOptions = {
  enabled: boolean
  connectDelayMs: number
  bridgeBase: string
  bridgeToken?: string
  pollIntervalMs?: number
  token?: string
  email?: string
  password?: string
  apiBase?: string
  wsBase?: string
}

type AutodartsServiceOptions = {
  enabled: boolean
  mode?: AutodartsRuntimeMode
  connectDelayMs?: number
  autoDartIntervalMs?: number
  real?: {
    bridgeBase?: string
    bridgeToken?: string
    pollIntervalMs?: number
    token?: string
    email?: string
    password?: string
    apiBase?: string
    wsBase?: string
  }
}

type RoomBinding = {
  roomCode: string
  deviceId: string
  runtimeMode: AutodartsRuntimeMode
  status: AutodartsConnectionStatus
  mockMode: AutodartsMockMode
  lastConnectedAt: number | null
  lastEventAt: number | null
  lastError: string | null
  adapter: AutodartsAdapter | null
  offStatus: (() => void) | null
  offDart: (() => void) | null
}

class MockAutodartsAdapter implements AutodartsAdapter {
  private readonly enabled: boolean
  private readonly connectDelayMs: number
  private readonly autoDartIntervalMs: number
  private readonly mockMode: AutodartsMockMode
  private statusListeners: Array<(payload: AdapterStatusPayload) => void> = []
  private dartListeners: Array<(dart: Dart) => void> = []
  private connectTimer: NodeJS.Timeout | null = null
  private autoTimer: NodeJS.Timeout | null = null

  constructor(options: MockAdapterOptions) {
    this.enabled = options.enabled
    this.connectDelayMs = options.connectDelayMs
    this.autoDartIntervalMs = options.autoDartIntervalMs
    this.mockMode = options.mockMode
  }

  async connect(_args: { deviceId: string }): Promise<void> {
    this.emitStatus({ status: 'CONNECTING' })
    this.clearTimers()
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null
      if (!this.enabled) {
        this.emitStatus({ status: 'ERROR', error: 'AUTODARTS_DISABLED' })
        return
      }

      this.emitStatus({ status: 'CONNECTED' })

      if (this.mockMode === 'AUTO') {
        this.autoTimer = setInterval(() => {
          this.emitDart(randomDart())
        }, this.autoDartIntervalMs)
      }
    }, this.connectDelayMs)
  }

  async disconnect(): Promise<void> {
    this.clearTimers()
    this.emitStatus({ status: 'DISCONNECTED' })
  }

  onStatus(cb: (payload: AdapterStatusPayload) => void): () => void {
    this.statusListeners.push(cb)
    return () => {
      this.statusListeners = this.statusListeners.filter((fn) => fn !== cb)
    }
  }

  onDart(cb: (dart: Dart) => void): () => void {
    this.dartListeners.push(cb)
    return () => {
      this.dartListeners = this.dartListeners.filter((fn) => fn !== cb)
    }
  }

  private emitStatus(payload: AdapterStatusPayload): void {
    for (const cb of this.statusListeners) cb(payload)
  }

  private emitDart(dart: Dart): void {
    for (const cb of this.dartListeners) cb(dart)
  }

  private clearTimers(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    if (this.autoTimer) {
      clearInterval(this.autoTimer)
      this.autoTimer = null
    }
  }
}

class RealAutodartsAdapter implements AutodartsAdapter {
  private readonly enabled: boolean
  private readonly connectDelayMs: number
  private readonly token?: string
  private readonly email?: string
  private readonly password?: string
  private readonly apiBase?: string
  private readonly wsBase?: string
  private readonly bridgeBase: string
  private readonly bridgeToken?: string
  private readonly pollIntervalMs: number
  private statusListeners: Array<(payload: AdapterStatusPayload) => void> = []
  private dartListeners: Array<(dart: Dart) => void> = []
  private pollTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private sessionId: string | null = null
  private lastEventId: string | null = null
  private lastConnectArgs: { deviceId: string } | null = null
  private reconnectAttempts = 0
  private readonly seenEventIds = new Set<string>()
  private readonly seenEventQueue: string[] = []
  private stopped = false

  constructor(options: RealAdapterOptions) {
    this.enabled = options.enabled
    this.connectDelayMs = options.connectDelayMs
    this.token = options.token
    this.email = options.email
    this.password = options.password
    this.apiBase = options.apiBase
    this.wsBase = options.wsBase
    this.bridgeBase = options.bridgeBase.replace(/\/+$/, '')
    this.bridgeToken = options.bridgeToken
    this.pollIntervalMs = options.pollIntervalMs ?? 900
  }

  async connect(_args: { deviceId: string }): Promise<void> {
    this.stopped = false
    this.lastConnectArgs = _args
    this.reconnectAttempts = 0
    this.clearReconnectTimer()
    await this.connectInternal(_args, true)
  }

  private async connectInternal(args: { deviceId: string }, resetCursor: boolean): Promise<void> {
    this.emitStatus({ status: 'CONNECTING' })
    await delay(this.connectDelayMs)

    if (this.stopped) return

    if (!this.enabled) {
      this.failAndScheduleReconnect('AUTODARTS_DISABLED')
      return
    }

    const hasCredentials = Boolean(this.token) || (Boolean(this.email) && Boolean(this.password))
    if (!hasCredentials) {
      this.failAndScheduleReconnect('AUTODARTS_MISSING_CREDENTIALS')
      return
    }

    try {
      const session = await this.bridgeRequest('/api/session/connect', {
        method: 'POST',
        body: {
          deviceId: args.deviceId,
          token: this.token,
          email: this.email,
          password: this.password,
          apiBase: this.apiBase,
          wsBase: this.wsBase,
        },
      })

      const sid = typeof session?.sessionId === 'string' ? session.sessionId.trim() : ''
      if (!sid) {
        this.failAndScheduleReconnect('AUTODARTS_BRIDGE_INVALID_SESSION')
        return
      }

      this.sessionId = sid
      if (resetCursor) {
        this.lastEventId = null
        this.seenEventIds.clear()
        this.seenEventQueue.length = 0
      }
      this.reconnectAttempts = 0
      this.emitStatus({ status: 'CONNECTED' })
      this.schedulePoll()
    } catch (err) {
      this.failAndScheduleReconnect(err instanceof Error ? err.message : 'AUTODARTS_BRIDGE_CONNECT_FAILED')
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.clearReconnectTimer()
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    await this.teardownRemoteSession()

    this.emitStatus({ status: 'DISCONNECTED' })
  }

  onStatus(cb: (payload: AdapterStatusPayload) => void): () => void {
    this.statusListeners.push(cb)
    return () => {
      this.statusListeners = this.statusListeners.filter((fn) => fn !== cb)
    }
  }

  onDart(cb: (dart: Dart) => void): () => void {
    this.dartListeners.push(cb)
    return () => {
      this.dartListeners = this.dartListeners.filter((fn) => fn !== cb)
    }
  }

  private emitStatus(payload: AdapterStatusPayload): void {
    for (const cb of this.statusListeners) cb(payload)
  }

  private emitDart(dart: Dart): void {
    for (const cb of this.dartListeners) cb(dart)
  }

  private schedulePoll(): void {
    if (this.stopped) return
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => {
      void this.pollLoop()
    }, this.pollIntervalMs)
  }

  private async pollLoop(): Promise<void> {
    if (this.stopped || !this.sessionId) return
    try {
      const data = await this.bridgeRequest('/api/session/events', {
        method: 'POST',
        body: {
          sessionId: this.sessionId,
          after: this.lastEventId,
        },
      })

      const events = Array.isArray(data?.events) ? data.events : []
      for (const evt of events) {
        const id = typeof evt?.id === 'string' ? evt.id.trim() : ''
        const segment = Number(evt?.segment)
        const multiplier = Number(evt?.multiplier)
        if (!id) continue
        if (this.isDuplicateEventId(id)) {
          this.lastEventId = id
          continue
        }
        if (!Number.isInteger(segment) || segment < 0 || segment > 25) continue
        if (!(multiplier === 0 || multiplier === 1 || multiplier === 2 || multiplier === 3)) continue
        this.lastEventId = id
        this.markEventSeen(id)
        this.emitDart({
          segment,
          multiplier: multiplier as 0 | 1 | 2 | 3,
        })
      }
    } catch (err) {
      await this.teardownRemoteSession()
      this.failAndScheduleReconnect(err instanceof Error ? err.message : 'AUTODARTS_BRIDGE_POLL_FAILED')
      return
    }
    this.schedulePoll()
  }

  private isDuplicateEventId(id: string): boolean {
    return this.seenEventIds.has(id)
  }

  private markEventSeen(id: string): void {
    if (this.seenEventIds.has(id)) return
    this.seenEventIds.add(id)
    this.seenEventQueue.push(id)
    while (this.seenEventQueue.length > 256) {
      const oldest = this.seenEventQueue.shift()
      if (oldest) this.seenEventIds.delete(oldest)
    }
  }

  private async teardownRemoteSession(): Promise<void> {
    const sid = this.sessionId
    this.sessionId = null
    if (!sid) return
    try {
      await this.bridgeRequest('/api/session/disconnect', {
        method: 'POST',
        body: { sessionId: sid },
      })
    } catch {
      // ignore bridge disconnect failures
    }
  }

  private failAndScheduleReconnect(error: string): void {
    if (this.stopped) return
    this.emitStatus({ status: 'ERROR', error })
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.lastConnectArgs) return
    this.clearReconnectTimer()
    const delayMs = Math.min(15000, 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 4)))
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped || !this.lastConnectArgs) return
      void this.connectInternal(this.lastConnectArgs, false)
    }, delayMs)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private async bridgeRequest(
    route: string,
    args: { method: 'POST' | 'GET'; body?: Record<string, unknown> },
  ): Promise<any> {
    const url = `${this.bridgeBase}${route}`
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (this.bridgeToken) headers.authorization = `Bearer ${this.bridgeToken}`

    const res = await fetch(url, {
      method: args.method,
      headers,
      body: args.body ? JSON.stringify(args.body) : undefined,
    })

    if (!res.ok) {
      throw new Error(`AUTODARTS_BRIDGE_HTTP_${res.status}`)
    }

    let data: any
    try {
      data = await res.json()
    } catch {
      throw new Error('AUTODARTS_BRIDGE_BAD_JSON')
    }

    if (!data?.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'AUTODARTS_BRIDGE_REQUEST_FAILED'
      throw new Error(message)
    }

    return data
  }
}

export class AutodartsService extends EventEmitter {
  private readonly enabled: boolean
  private readonly mode: AutodartsRuntimeMode
  private readonly connectDelayMs: number
  private readonly autoDartIntervalMs: number
  private readonly realOptions: AutodartsServiceOptions['real']
  private readonly bindings = new Map<string, RoomBinding>()

  constructor(options: AutodartsServiceOptions) {
    super()
    this.enabled = options.enabled
    this.mode = options.mode ?? 'MOCK'
    this.connectDelayMs = options.connectDelayMs ?? 350
    this.autoDartIntervalMs = options.autoDartIntervalMs ?? 5000
    this.realOptions = options.real
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  public getMode(): AutodartsRuntimeMode {
    return this.mode
  }

  public bindRoom(args: {
    roomCode: string
    deviceId: string
    runtimeMode?: AutodartsRuntimeMode
    mockMode?: AutodartsMockMode
    realAuth?: {
      token?: string
      email?: string
      password?: string
      apiBase?: string
      wsBase?: string
    }
  }): AutodartsRoomState {
    const deviceId = args.deviceId.trim()
    if (!deviceId) throw new Error('Device id is required')

    this.unbindRoom(args.roomCode)
    const runtimeMode = args.runtimeMode ?? this.mode

    const binding: RoomBinding = {
      roomCode: args.roomCode,
      deviceId,
      runtimeMode,
      status: 'CONNECTING',
      mockMode: args.mockMode ?? 'MANUAL',
      lastConnectedAt: null,
      lastEventAt: null,
      lastError: null,
      adapter: null,
      offStatus: null,
      offDart: null,
    }

    const adapter =
      runtimeMode === 'MOCK'
        ? new MockAutodartsAdapter({
            enabled: this.enabled,
            connectDelayMs: this.connectDelayMs,
            autoDartIntervalMs: this.autoDartIntervalMs,
            mockMode: binding.mockMode,
          })
        : new RealAutodartsAdapter({
            enabled: this.enabled,
            connectDelayMs: this.connectDelayMs,
            bridgeBase: this.realOptions?.bridgeBase ?? 'http://127.0.0.1:6876',
            bridgeToken: this.realOptions?.bridgeToken,
            pollIntervalMs: this.realOptions?.pollIntervalMs,
            token: args.realAuth?.token ?? this.realOptions?.token,
            email: args.realAuth?.email ?? this.realOptions?.email,
            password: args.realAuth?.password ?? this.realOptions?.password,
            apiBase: args.realAuth?.apiBase ?? this.realOptions?.apiBase,
            wsBase: args.realAuth?.wsBase ?? this.realOptions?.wsBase,
          })

    binding.adapter = adapter
    binding.offStatus = adapter.onStatus((payload) => {
      const current = this.bindings.get(args.roomCode)
      if (!current) return

      if (payload.status === 'CONNECTING') {
        current.status = 'CONNECTING'
        current.lastError = null
      } else if (payload.status === 'CONNECTED') {
        current.status = 'CONNECTED'
        current.lastConnectedAt = Date.now()
        current.lastError = null
      } else if (payload.status === 'DISCONNECTED') {
        current.status = 'DISCONNECTED'
      } else {
        current.status = 'ERROR'
        current.lastError = payload.error ?? 'AUTODARTS_CONNECTION_ERROR'
      }

      this.emitState(args.roomCode)
    })

    binding.offDart = adapter.onDart((dart) => {
      const current = this.bindings.get(args.roomCode)
      if (!current || current.status !== 'CONNECTED') return

      current.lastEventAt = Date.now()
      const event: AutodartsDartEvent = {
        roomCode: current.roomCode,
        deviceId: current.deviceId,
        source: current.runtimeMode === 'MOCK' ? 'MOCK_AUTO' : 'REAL',
        createdAt: current.lastEventAt,
        dart,
      }
      this.emit('dart', event)
      this.emitState(current.roomCode)
    })

    this.bindings.set(args.roomCode, binding)
    this.emitState(args.roomCode)

    void adapter.connect({ deviceId }).catch((err: unknown) => {
      const current = this.bindings.get(args.roomCode)
      if (!current) return
      current.status = 'ERROR'
      current.lastError = err instanceof Error ? err.message : 'AUTODARTS_CONNECT_FAILED'
      this.emitState(args.roomCode)
    })

    return this.getRoomState(args.roomCode)
  }

  public unbindRoom(roomCode: string): void {
    const binding = this.bindings.get(roomCode)
    if (!binding) return

    if (binding.offStatus) binding.offStatus()
    if (binding.offDart) binding.offDart()
    binding.offStatus = null
    binding.offDart = null

    if (binding.adapter) {
      void binding.adapter.disconnect().catch(() => {
        // ignore
      })
      binding.adapter = null
    }

    this.bindings.delete(roomCode)
    this.emitState(roomCode)
  }

  public getRoomState(roomCode: string): AutodartsRoomState {
    const binding = this.bindings.get(roomCode)
    if (!binding) {
      return {
        roomCode,
        deviceId: null,
        runtimeMode: this.mode,
        status: 'DISCONNECTED',
        mockMode: null,
        lastConnectedAt: null,
        lastEventAt: null,
        lastError: null,
      }
    }

    return {
      roomCode,
      deviceId: binding.deviceId,
      runtimeMode: binding.runtimeMode,
      status: binding.status,
      mockMode: binding.runtimeMode === 'MOCK' ? binding.mockMode : null,
      lastConnectedAt: binding.lastConnectedAt,
      lastEventAt: binding.lastEventAt,
      lastError: binding.lastError,
    }
  }

  public emitMockDart(roomCode: string, dart: Dart, source: AutodartsDartEvent['source'] = 'MOCK_MANUAL'): AutodartsDartEvent {
    const binding = this.bindings.get(roomCode)
    if (!binding) throw new Error('Room is not bound to an autodarts device')
    if (binding.status !== 'CONNECTED') throw new Error('Autodarts device is not connected')

    binding.lastEventAt = Date.now()
    const event: AutodartsDartEvent = {
      roomCode,
      deviceId: binding.deviceId,
      source,
      createdAt: binding.lastEventAt,
      dart,
    }

    this.emit('dart', event)
    this.emitState(roomCode)
    return event
  }

  private emitState(roomCode: string): void {
    const payload: StateEvent = {
      roomCode,
      state: this.getRoomState(roomCode),
    }
    this.emit('state', payload)
  }
}

function randomDart(): Dart {
  const roll = Math.random()
  if (roll < 0.1) return { segment: 25, multiplier: 2 }
  if (roll < 0.2) return { segment: 25, multiplier: 1 }
  if (roll < 0.3) return { segment: 0, multiplier: 0 }

  const segment = Math.floor(Math.random() * 20) + 1
  const multiplierRoll = Math.random()
  const multiplier = multiplierRoll < 0.55 ? 1 : multiplierRoll < 0.82 ? 3 : 2
  return { segment, multiplier }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
