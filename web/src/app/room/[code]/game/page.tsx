'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type { Dart, MatchSnapshot, Player, PlayerStats, RoomSnapshot } from '@/lib/types'
import { suggestCheckout, type OutRule } from '@/lib/checkout'
import DartKeypad from '@/components/DartKeypad'
import { ScoringHeader, ScoringMenu, ScoringMenuSection } from '@/components/ScoringScreen'

type VoiceLang = 'EN' | 'NL' | 'DE'

export default function GamePage() {
  const params = useParams<{ code: string }>()
  const code = (params.code ?? '').toUpperCase()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [snap, setSnap] = useState<RoomSnapshot | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const scoreTrackRef = useRef<HTMLDivElement>(null)

  const [totalText, setTotalText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [entryRevision, setEntryRevision] = useState(0)
  const submittingRef = useRef(false)
  const [entryMode, setEntryMode] = useState<'TOTAL' | 'PER_DART'>('TOTAL')
  const [darts, setDarts] = useState<Dart[]>([
    { segment: 0, multiplier: 0 },
    { segment: 0, multiplier: 0 },
    { segment: 0, multiplier: 0 },
  ])

  const [autodartsBuffer, setAutodartsBuffer] = useState<Dart[]>([])
  const [autodartsBufferPlayerId, setAutodartsBufferPlayerId] = useState<string | null>(null)
  const [autodartsBufferReady, setAutodartsBufferReady] = useState(false)
  const [autodartsBufferReason, setAutodartsBufferReason] = useState<'THREE_DARTS' | 'BUST' | 'CHECKOUT' | null>(null)
  const [autodartsLastDart, setAutodartsLastDart] = useState<Dart | null>(null)
  const [autodartsLoadedForReview, setAutodartsLoadedForReview] = useState<{ playerId: string; darts: Dart[] } | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceLastTranscript, setVoiceLastTranscript] = useState<string>('')
  const [voiceHelpOpen, setVoiceHelpOpen] = useState(false)
  const [voiceCalloutsEnabled, setVoiceCalloutsEnabled] = useState(true)
  const [voiceAlwaysOn, setVoiceAlwaysOn] = useState(false)
  const [voicePausedForCallout, setVoicePausedForCallout] = useState(false)
  const voiceLang: VoiceLang = 'EN'
  const [hostSecret, setHostSecret] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const missingBoardNoticeKeyRef = useRef('')
  const speechRef = useRef<any>(null)
  const voiceAlwaysOnRef = useRef(false)
  const voiceListeningRef = useRef(false)
  const voiceManualStopRef = useRef(false)
  const suppressVoiceRestartRef = useRef(false)
  const calloutQueueDepthRef = useRef(0)
  const voiceRestartTimerRef = useRef<number | null>(null)
  const voicePendingSubmitRef = useRef<{ mode: 'TOTAL' | 'PER_DART'; total?: number; darts?: Dart[] } | null>(null)
  const finishedRef = useRef(false)
  const lastCheckoutReminderKeyRef = useRef('')
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve())
  const activeCalloutAudioRef = useRef<HTMLAudioElement | null>(null)
  const missingCalloutAudioRef = useRef<Set<string>>(new Set())

  const enqueueCalloutPlayback = useCallback((job: () => Promise<void> | void) => {
    calloutQueueDepthRef.current += 1
    playbackQueueRef.current = playbackQueueRef.current
      .then(async () => {
        const wasListening = Boolean(speechRef.current)
        if (wasListening) {
          suppressVoiceRestartRef.current = true
          setVoicePausedForCallout(true)
          await waitForVoiceIdle(900)
          if (speechRef.current) {
            try {
              speechRef.current?.abort?.()
            } catch {
              // ignore
            }
            await sleep(140)
          }
          setVoiceListening(false)
          speechRef.current = null
        }

        try {
          await Promise.resolve(job())
        } finally {
          calloutQueueDepthRef.current = Math.max(0, calloutQueueDepthRef.current - 1)
          if (calloutQueueDepthRef.current === 0) {
            suppressVoiceRestartRef.current = false
            setVoicePausedForCallout(false)
          }
          if (calloutQueueDepthRef.current === 0) {
            scheduleVoiceRestart(180)
          }
        }
      })
      .catch(() => undefined)
    return playbackQueueRef.current
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setHydrated(true)
    setHostSecret(localStorage.getItem('dc_hostSecret'))
    const savedCallouts = localStorage.getItem('dc_voiceCallouts')
    if (savedCallouts === 'off') setVoiceCalloutsEnabled(false)
    const savedAlwaysOn = localStorage.getItem('dc_voiceAlwaysOn')
    if (savedAlwaysOn === 'on') setVoiceAlwaysOn(true)
    const ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setVoiceSupported(Boolean(ctor))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('dc_voiceCallouts', voiceCalloutsEnabled ? 'on' : 'off')
  }, [voiceCalloutsEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('dc_voiceAlwaysOn', voiceAlwaysOn ? 'on' : 'off')
  }, [voiceAlwaysOn])

  useEffect(() => {
    if (!hydrated) return
    const socket = getSocket(serverUrl)
    let mounted = true

    socket.on('room:snapshot', (s: any) => {
      if (!mounted) return
      if (s?.code?.toUpperCase?.() !== code) return
      setSnap(s)
      const debug = s?.room?.autodartsRoutingDebug
      if (debug?.missingPersonalDevice && debug?.currentPlayerUserId) {
        const key = `${debug.currentPlayerUserId}:${debug.currentPlayerId ?? 'none'}:${s?.match?.currentLegIndex ?? 'none'}`
        if (missingBoardNoticeKeyRef.current !== key) {
          missingBoardNoticeKeyRef.current = key
          setToast(`No personal autodarts device saved for ${debug.currentPlayerName ?? 'current player'}`)
          setTimeout(() => setToast(null), 2200)
        }
      } else {
        missingBoardNoticeKeyRef.current = ''
      }

      const pending = s?.room?.autodartsPending ?? null
      if (pending) {
        const pendingDarts = toEditorDarts(Array.isArray(pending.darts) ? pending.darts : [])
        setAutodartsBufferPlayerId(typeof pending.playerId === 'string' ? pending.playerId : null)
        setAutodartsBuffer(Array.isArray(pending.darts) ? pending.darts : [])
        setAutodartsBufferReady(Boolean(pending.ready))
        setAutodartsBufferReason(
          pending.reason === 'THREE_DARTS' || pending.reason === 'BUST' || pending.reason === 'CHECKOUT' ? pending.reason : null,
        )
        if (pendingDarts.length > 0) {
          setEntryMode('PER_DART')
          setDarts(pendingDarts)
        }
        if (pending.ready) {
          setAutodartsLoadedForReview({ playerId: typeof pending.playerId === 'string' ? pending.playerId : '', darts: pendingDarts })
        }
      } else {
        setAutodartsBuffer([])
        setAutodartsBufferPlayerId(null)
        setAutodartsBufferReady(false)
        setAutodartsBufferReason(null)
        setAutodartsLoadedForReview(null)
      }

      if (s?.match?.status !== 'LIVE') {
        setAutodartsBuffer([])
        setAutodartsBufferPlayerId(null)
        setAutodartsBufferReady(false)
        setAutodartsBufferReason(null)
        setAutodartsLoadedForReview(null)
      }
    })

    socket.on('room:autodartsDart', (evt: any) => {
      if (!mounted) return
      if (evt?.roomCode?.toUpperCase?.() !== code) return
      if (evt?.dart) {
        setAutodartsLastDart(evt.dart)
      }
    })

    socket.on('room:autodartsTurnBuffer', (evt: any) => {
      if (!mounted) return
      const playerId = typeof evt?.playerId === 'string' ? evt.playerId : null
      const dartsIn = Array.isArray(evt?.darts) ? evt.darts : []
      const editorDarts = toEditorDarts(dartsIn)
      setAutodartsBufferPlayerId(playerId)
      setAutodartsBuffer(dartsIn)
      setAutodartsBufferReady(Boolean(evt?.ready))
      setAutodartsBufferReason(
        evt?.reason === 'THREE_DARTS' || evt?.reason === 'BUST' || evt?.reason === 'CHECKOUT' ? evt.reason : null,
      )
      if (editorDarts.length > 0) {
        setEntryMode('PER_DART')
        setDarts(editorDarts)
      }
      if (evt?.ready) {
        setAutodartsLoadedForReview({ playerId: playerId ?? '', darts: editorDarts })
        setToast('Autodarts captured turn. Review and submit.')
        setTimeout(() => setToast(null), 1800)
      }
    })

    socket.on('room:autodartsTurnCleared', (evt: any) => {
      if (!mounted) return
      setAutodartsBuffer([])
      setAutodartsBufferPlayerId(null)
      setAutodartsBufferReady(false)
      setAutodartsBufferReason(null)
      setAutodartsLoadedForReview(null)
      const who = typeof evt?.by === 'string' ? evt.by : 'player'
      setToast(`Autodarts turn cleared by ${who}`)
      setTimeout(() => setToast(null), 1600)
    })

    socket.on('room:turnAccepted', (evt: any) => {
      voicePendingSubmitRef.current = null
      if (!mounted || !voiceCalloutsEnabled) return
      void enqueueCalloutPlayback(() => playTurnCallout(evt, voiceLang, activeCalloutAudioRef, missingCalloutAudioRef))
    })

    const name = localStorage.getItem('dc_authDisplayName') || localStorage.getItem('dc_name') || 'Guest'
    const role = localStorage.getItem('dc_role')
    const authToken = localStorage.getItem('dc_authToken')
    socket
      .emitWithAck('room:join', {
        code,
        name,
        hostSecret: hostSecret ?? undefined,
        authToken: authToken ?? undefined,
        asSpectator: role === 'SPECTATOR',
      })
      .then((res: any) => {
        if (!res?.ok) {
          setToast(res?.message ?? 'Failed to join')
          return
        }
        if (res.role === 'PLAYER' && res.playerId) {
          rememberControlledPlayer(code, res.playerId)
        }
      })

    return () => {
      mounted = false
      socket.off('room:snapshot')
      socket.off('room:autodartsDart')
      socket.off('room:autodartsTurnBuffer')
      socket.off('room:autodartsTurnCleared')
      socket.off('room:turnAccepted')
    }
  }, [code, hostSecret, serverUrl, hydrated, voiceCalloutsEnabled, enqueueCalloutPlayback])

  const match = snap?.match
  const leg = match?.leg
  const settings = match?.settings
  const players = match?.players ?? []
  const currentIdx = leg?.currentPlayerIndex ?? -1
  const currentPlayer = currentIdx >= 0 ? players[currentIdx] : null
  const finished = match?.status === 'FINISHED'
  const winner = players.find((player) => player.id === leg?.winnerPlayerId)
  const tournamentId = snap?.room?.tournamentMatch?.tournamentId
  finishedRef.current = Boolean(finished)
  voiceAlwaysOnRef.current = voiceAlwaysOn
  voiceListeningRef.current = voiceListening
  const statsByPlayerId = match?.statsByPlayerId ?? {}
  const isX01 = settings?.gameType === 'X01'
  const isAround = settings?.gameType === 'AROUND'
  const isPractice = settings?.gameType === 'PRACTICE'
  const practicePerDartOnly = Boolean(isPractice && settings.practiceMode !== 'X01')
  const autodarts = snap?.room?.autodarts
  const autodartsActiveUserId = snap?.room?.autodartsActiveUserId ?? null
  const autodartsActivePlayerName = autodartsActiveUserId
    ? (snap?.clients ?? []).find((c) => c.userId === autodartsActiveUserId)?.name ?? null
    : null
  const isHost = Boolean(hostSecret)
  const localTournamentHostOverride = Boolean(isHost && snap?.room?.tournamentMatch?.participationMode === 'LOCAL')
  const autodartsBufferPlayerName = autodartsBufferPlayerId
    ? players.find((p) => p.id === autodartsBufferPlayerId)?.name ?? null
    : null
  const canSubmitByControl =
    localTournamentHostOverride || (hydrated && currentPlayer ? canSubmitForCurrent(code, currentPlayer.id) : false)
  const canClearAutodartsPending =
    autodartsBuffer.length > 0 &&
    (isHost || (hydrated && autodartsBufferPlayerId ? canSubmitForCurrent(code, autodartsBufferPlayerId) : false))
  const autodartsControllingTurn =
    Boolean(currentPlayer?.id) &&
    autodarts?.status === 'CONNECTED' &&
    autodartsBuffer.length > 0 &&
    autodartsBufferPlayerId === currentPlayer?.id
  const autodartsTurnReady = autodartsControllingTurn && autodartsBufferReady
  const canSubmitNow = match?.status === 'LIVE' && canSubmitByControl && (!autodartsControllingTurn || autodartsTurnReady)
  const autodartsReviewEdited =
    Boolean(autodartsLoadedForReview) &&
    (entryMode !== 'PER_DART' || !sameDarts(darts, autodartsLoadedForReview?.darts ?? []))

  const currentLegPlayer = currentPlayer ? leg?.players?.find((p) => p.playerId === currentPlayer.id) : null
  const perDartOnly = autodarts?.status === 'CONNECTED' || isAround || practicePerDartOnly || Boolean(isX01 && settings.doubleIn && currentLegPlayer && !currentLegPlayer.isIn)
  const outRule: OutRule = isX01 ? (settings.doubleOut ? 'DOUBLE' : settings.masterOut ? 'MASTER' : 'ANY') : 'ANY'
  const checkoutMax = outRule === 'MASTER' ? 180 : 170
  const checkoutSuggestion =
    isX01 &&
    currentLegPlayer &&
    currentLegPlayer.isIn &&
    currentLegPlayer.remaining <= checkoutMax &&
    currentLegPlayer.remaining > 1
      ? suggestCheckout({ remaining: currentLegPlayer.remaining, outRule })
      : null
  const settingsSummary = settings
    ? settings.gameType === 'X01'
      ? `${settings.startScore} · ${settings.doubleIn ? 'DI' : 'SI'} · ${settings.doubleOut ? 'DO' : settings.masterOut ? 'MO' : 'SO'}`
      : settings.gameType === 'AROUND'
        ? 'Around the Board'
        : `Practice · ${settings.practiceMode === 'X01' ? `X01 ${settings.startScore}` : settings.practiceMode.replaceAll('_', ' ')}`
    : null

  const [scoresTab, setScoresTab] = useState<'RECENT' | 'ALL'>('RECENT')

  useEffect(() => {
    if (perDartOnly) setEntryMode('PER_DART')
  }, [perDartOnly])

  useEffect(() => {
    if (!voiceCalloutsEnabled || !match || !currentPlayer || !currentLegPlayer) return
    if (match.status !== 'LIVE') return
    if (!currentLegPlayer.isIn) return
    const remaining = currentLegPlayer.remaining
    if (!Number.isInteger(remaining) || remaining <= 1 || remaining > checkoutMax) return

    const reminderKey = `${code}:${match.currentLegIndex}:${currentPlayer.id}:${remaining}:${outRule}`
    if (lastCheckoutReminderKeyRef.current === reminderKey) return
    lastCheckoutReminderKeyRef.current = reminderKey

    window.setTimeout(() => {
      void enqueueCalloutPlayback(() =>
        playCheckoutReminderCallout(remaining, voiceLang, activeCalloutAudioRef, missingCalloutAudioRef),
      )
    }, 380)
  }, [
    voiceCalloutsEnabled,
    match,
    code,
    currentPlayer,
    currentLegPlayer,
    checkoutMax,
    outRule,
    voiceLang,
    enqueueCalloutPlayback,
  ])

  async function clearAutodartsPending() {
    try {
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('game:autodartsClearPending')
      if (!res?.ok) throw new Error(res?.message ?? 'Failed to clear autodarts turn')
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    }
  }

  async function submitTurn(
    override?: { mode?: 'TOTAL' | 'PER_DART'; total?: number; darts?: Dart[] },
  ) {
    if (!canSubmitNow || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      setToast(null)
      const submittingAutodartsSuggestion = autodartsTurnReady
      const socket = getSocket(serverUrl)
      const payload: any = {}

      const mode = override?.mode ?? entryMode
      if ((settings?.gameType === 'AROUND' || (settings?.gameType === 'PRACTICE' && settings.practiceMode !== 'X01')) && mode === 'TOTAL') {
        throw new Error(`${settings.gameType} mode uses per-dart input only`)
      }
      if (mode === 'PER_DART') {
        payload.darts = override?.darts ?? darts
      } else {
        payload.total = override?.total ?? Number(totalText || '0')
        if (!Number.isInteger(payload.total) || payload.total < 0 || payload.total > 180) throw new Error('Enter a score from 0 to 180.')
      }

    const res = await socket.emitWithAck('game:submitTurn', payload)
      if (!res?.ok) {
        if (res?.code === 'NEED_DARTS_FOR_DOUBLE_IN' || res?.code === 'AUTODARTS_PER_DART_ONLY') setEntryMode('PER_DART')
        throw new Error(res?.message ?? 'Failed')
      }

      const submittedMode = override?.mode ?? entryMode
      setEntryRevision((revision) => revision + 1)
      if (submittedMode === 'TOTAL') {
        setTotalText('')
      } else {
        setDarts([
          { segment: 0, multiplier: 0 },
          { segment: 0, multiplier: 0 },
          { segment: 0, multiplier: 0 },
        ])
      }

      voicePendingSubmitRef.current = null
      if (submittingAutodartsSuggestion) {
        setAutodartsLoadedForReview(null)
      }
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!voiceSupported) return
    if (finished) {
      if (voiceListening) {
        voiceManualStopRef.current = true
        speechRef.current?.abort?.()
      }
      return
    }
    if (voiceAlwaysOn && !voiceListening) {
      if (calloutQueueDepthRef.current > 0) return
      voiceManualStopRef.current = false
      scheduleVoiceRestart(0)
    }
    if (!voiceAlwaysOn && voiceListening && voiceManualStopRef.current) {
      speechRef.current?.stop?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAlwaysOn, voiceSupported, finished])

  useEffect(() => {
    if (!voiceSupported || !voiceAlwaysOn || finished) return
    const timer = window.setInterval(() => {
      if (voiceManualStopRef.current) return
      if (calloutQueueDepthRef.current > 0) return
      if (speechRef.current || voiceListeningRef.current) return
      scheduleVoiceRestart(0)
    }, 1400)
    return () => window.clearInterval(timer)
  }, [voiceSupported, voiceAlwaysOn, finished])

  useEffect(() => {
    return () => {
      if (voiceRestartTimerRef.current != null) {
        window.clearTimeout(voiceRestartTimerRef.current)
        voiceRestartTimerRef.current = null
      }
    }
  }, [])

  function scheduleVoiceRestart(delayMs: number) {
    if (typeof window === 'undefined') return
    if (voiceRestartTimerRef.current != null) {
      window.clearTimeout(voiceRestartTimerRef.current)
      voiceRestartTimerRef.current = null
    }

    voiceRestartTimerRef.current = window.setTimeout(() => {
      voiceRestartTimerRef.current = null
      if (speechRef.current && !voiceListeningRef.current) {
        try {
          speechRef.current?.abort?.()
        } catch {
          // ignore
        }
        speechRef.current = null
      }
      if (!voiceAlwaysOnRef.current || voiceManualStopRef.current || finishedRef.current) return
      if (calloutQueueDepthRef.current > 0 || speechRef.current) return
      const started = startVoiceInput()
      if (!started) scheduleVoiceRestart(450)
    }, Math.max(0, delayMs))
  }

  async function waitForVoiceIdle(timeoutMs: number) {
    const end = Date.now() + Math.max(0, timeoutMs)
    while (speechRef.current && Date.now() < end) {
      await sleep(40)
    }
  }

  async function toggleVoiceInput() {
    if (!voiceSupported || typeof window === 'undefined') {
      setToast('Voice input not supported in this browser')
      setTimeout(() => setToast(null), 1800)
      return
    }

    if (voiceListening) {
      setVoiceAlwaysOn(false)
      voiceManualStopRef.current = true
      speechRef.current?.abort?.()
      setVoiceListening(false)
      return
    }

    const permissionGranted = await requestMicrophonePermission()
    if (!permissionGranted) return

    voiceManualStopRef.current = false
    if (!startVoiceInput()) {
      setToast('Voice input could not start. Opera GX may not provide the required speech service.')
      setTimeout(() => setToast(null), 3200)
    }
  }

  async function requestMicrophonePermission(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setToast('Microphone access requires HTTPS or localhost in a supported browser')
      setTimeout(() => setToast(null), 3000)
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      return true
    } catch (err: any) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
      setToast(denied ? 'Microphone permission was blocked. Allow it in site settings and try again.' : 'No microphone is available.')
      setTimeout(() => setToast(null), 3400)
      return false
    }
  }

  function startVoiceInput(): boolean {
    if (!voiceSupported || typeof window === 'undefined' || finishedRef.current || calloutQueueDepthRef.current > 0) return false
    if (speechRef.current) return false

    const ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new ctor()
    speechRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setVoiceListening(true)
    }

    rec.onend = () => {
      setVoiceListening(false)
      speechRef.current = null
      if (suppressVoiceRestartRef.current) {
        return
      }
      if (voiceAlwaysOnRef.current && !voiceManualStopRef.current && !finishedRef.current && calloutQueueDepthRef.current === 0) {
        scheduleVoiceRestart(220)
      }
    }

    rec.onerror = (evt: any) => {
      setVoiceListening(false)
      speechRef.current = null
      if (suppressVoiceRestartRef.current) {
        return
      }
      setToast(voiceRecognitionErrorMessage(evt?.error))
      setTimeout(() => setToast(null), 3400)
    }

    rec.onresult = (evt: any) => {
      const transcript = String(evt?.results?.[0]?.[0]?.transcript ?? '').trim()
      setVoiceLastTranscript(transcript)
      const shouldSubmit = parseVoiceSubmitIntent(transcript)
      const missIntent = parseVoiceMissIntent(transcript)
      const checkIntent = parseVoiceCheckIntent(transcript)
      const parsed = parseVoiceTurn(transcript)
      if (parsed) {
        const parsedDarts = toEditorDarts(parsed)
        setEntryMode('PER_DART')
        setDarts(parsedDarts)
        voicePendingSubmitRef.current = { mode: 'PER_DART', darts: parsedDarts }
        setToast(`Voice captured: ${parsed.map((d: Dart) => dartToLabel(d)).join(', ')}`)
        setTimeout(() => setToast(null), 1800)
        if (shouldSubmit) {
          void submitTurn({ mode: 'PER_DART', darts: parsedDarts })
        }
        return
      }

      const score = parseVoiceScore180(transcript)
      if (score != null) {
        if (isAround || isPractice) {
          setToast(`${settings?.gameType ?? 'This'} mode expects dart calls, e.g. "single 7"`)
          setTimeout(() => setToast(null), 1800)
          return
        }
        setEntryMode('TOTAL')
        setTotalText(String(score))
        voicePendingSubmitRef.current = { mode: 'TOTAL', total: score }
        setToast(`Voice score: ${score}`)
        setTimeout(() => setToast(null), 1800)
        if (shouldSubmit) {
          void submitTurn({ mode: 'TOTAL', total: score })
        }
        return
      }

      if (shouldSubmit && missIntent) {
        setEntryMode('TOTAL')
        setTotalText('0')
        voicePendingSubmitRef.current = { mode: 'TOTAL', total: 0 }
        void submitTurn({ mode: 'TOTAL', total: 0 })
        setToast('Voice score: MISS (0)')
        setTimeout(() => setToast(null), 1800)
        return
      }

      if (shouldSubmit && checkIntent) {
        const remaining = Number(currentLegPlayer?.remaining)
        if (Number.isInteger(remaining) && remaining >= 0 && remaining <= 180) {
          setEntryMode('TOTAL')
          setTotalText(String(remaining))
          voicePendingSubmitRef.current = { mode: 'TOTAL', total: remaining }
          void submitTurn({ mode: 'TOTAL', total: remaining })
          setToast(`Voice score: CHECK (${remaining})`)
          setTimeout(() => setToast(null), 1800)
          return
        }
      }

      if (shouldSubmit) {
        const pending = voicePendingSubmitRef.current
        if (pending) {
          void submitTurn(pending)
          setToast('Submitted voice score')
          setTimeout(() => setToast(null), 1800)
          return
        }

        setToast('Say a score first, then "submit". Example: "forty" then "submit"')
        setTimeout(() => setToast(null), 1800)
        return
      }

      setToast('Could not parse voice input')
      setTimeout(() => setToast(null), 1800)
    }

    try {
      rec.start()
      return true
    } catch {
      speechRef.current = null
      setVoiceListening(false)
      return false
    }
  }

  useEffect(() => {
    const track = scoreTrackRef.current
    const active = track?.querySelector('[data-current=true]')
    if (!track || !active || track.scrollWidth <= track.clientWidth) return
    const visible = track.getBoundingClientRect()
    const card = active.getBoundingClientRect()
    if (card.left < visible.left) track.scrollLeft += card.left - visible.left
    else if (card.right > visible.right) track.scrollLeft += card.right - visible.right
  }, [currentPlayer?.id, players.length])

  const scoringTools = (
    <ScoringMenuSection title="Scoring settings" hint={autodarts?.status === 'CONNECTED' ? 'Board connected' : 'Voice & Autodarts'}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="pill">Autodarts: {autodarts?.status ?? 'DISCONNECTED'}</span>
            <span className="pill">Device: {autodarts?.deviceId ?? 'none'}</span>
            <span className="pill">Active player board: {autodartsActivePlayerName ?? 'none'}</span>
             {perDartOnly ? <span className="pill" style={{ color: 'var(--accent)' }}>Per-dart entry</span> : null}
            {autodartsLastDart ? <span className="pill">Last dart: {dartToLabel(autodartsLastDart)}</span> : null}
            <button className="btn" onClick={() => void toggleVoiceInput()} disabled={finished}>
              {voiceListening ? 'Stop voice' : 'Voice input'}
            </button>
            <button className="btn" onClick={() => setVoiceHelpOpen((v) => !v)}>
              {voiceHelpOpen ? 'Hide voice help' : 'Voice help'}
            </button>
            <button className="btn" onClick={() => setVoiceCalloutsEnabled((v) => !v)}>
              Callouts: {voiceCalloutsEnabled ? 'on' : 'off'}
            </button>
            <button className="btn" onClick={() => setVoiceAlwaysOn((v) => !v)} disabled={!voiceSupported || finished}>
              Voice always-on: {voiceAlwaysOn ? 'on' : 'off'}
            </button>
            {voiceLastTranscript ? <span className="pill">Heard: {voiceLastTranscript}</span> : null}
            {voicePausedForCallout ? <span className="pill">Listening paused during callout</span> : null}
          </div>

        </div>

        {autodartsBuffer.length > 0 ? (
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <span className="pill">Buffer {autodartsBufferPlayerName ? `(${autodartsBufferPlayerName})` : ''}</span>
            {autodartsBuffer.map((d, i) => (
              <span key={`${d.segment}-${d.multiplier}-${i}`} className="pill" style={{ color: 'var(--text)' }}>
                {dartToLabel(d)}
              </span>
            ))}
            {autodartsBufferReady ? (
              <span className="pill" style={{ color: 'var(--good)' }}>
                Ready to submit{autodartsBufferReason ? ` (${autodartsBufferReason.toLowerCase()})` : ''}
              </span>
            ) : (
              <span className="pill">Capturing...</span>
            )}
            {autodartsLoadedForReview ? (
               <span className="pill" style={{ color: autodartsReviewEdited ? 'var(--bad)' : 'var(--text)' }}>
                {autodartsReviewEdited ? 'Edited before submit' : 'Unchanged'}
              </span>
            ) : null}
            {canClearAutodartsPending ? (
              <button className="btn" onClick={clearAutodartsPending}>
                Reject autodarts turn
              </button>
            ) : null}
          </div>
        ) : null}

        {autodarts?.lastError ? <div className="help" style={{ color: 'var(--bad)', marginTop: 8 }}>Error: {autodarts.lastError}</div> : null}

        {voiceHelpOpen ? (
          <div className="col" style={{ marginTop: 8 }}>
            <div className="help">Voice cheat sheet</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill">Darts: "triple 20, double 20, miss"</span>
              <span className="pill">Short: "t20 d20 sb"</span>
              <span className="pill">EN: single/double/triple/treble/miss</span>
              <span className="pill">NL: enkel/dubbel/trippel</span>
              <span className="pill">DE: einfach/doppel/dreifach/fehlwurf</span>
              <span className="pill">Totals: say 1..180 ("100", "one hundred eighty")</span>
              <span className="pill">Submit: say "submit" or "submit 100"</span>
            </div>
          </div>
        ) : null}
    </ScoringMenuSection>
  )

  return (
    <main className="gamePage">
      <ScoringHeader title={isPractice ? 'Practice' : 'Scoreboard'} detail={settingsSummary ?? `Room ${code}`}
        back={isPractice ? '/create?mode=practice' : finished ? `/room/${code}/lobby` : '/'}
        backLabel={isPractice ? 'Back to practice setup' : finished ? 'Back to lobby' : 'Back to home'} />
      {finished ? (
        <section className="card resultBanner" aria-label="Match result">
          <div><span className="eyebrow">Final result</span><h2 className="sectionTitle" role="status">{isPractice ? 'Practice complete' : winner ? `${winner.name} wins` : 'Match complete'}</h2></div>
          <Link className="btn btnPrimary" href={tournamentId ? `/tournaments/${encodeURIComponent(tournamentId)}` : isPractice ? '/create?mode=practice' : `/room/${code}/lobby`}>
            {tournamentId ? 'Back to bracket' : isPractice ? 'New practice session' : 'Back to lobby'}
          </Link>
        </section>
      ) : null}
      <div className="gameGrid" data-entry={!finished && (canSubmitNow || autodartsControllingTurn)}>
        <section className="scoreboard" aria-label={finished ? 'Final scores' : 'Live scores'}>
          <div className="scoreboardLabel">
            <span>{finished ? 'Final scores' : isPractice ? 'Training score' : 'Live scores'}</span>
            {match && !isPractice ? <span>{settings?.setsEnabled ? `Set ${match.currentSetNumber} · ` : ''}Leg {match.currentLeg.legNumber}</span> : null}
          </div>
          <div ref={scoreTrackRef} className="gamePlayers" data-solo={players.length < 2} data-many={players.length > 2}>
            {players.map((p) => <PlayerPanel key={p.id} player={p} isCurrent={!finished && p.id === currentPlayer?.id}
              leg={leg} settings={settings} match={match} stats={statsByPlayerId[p.id]} />)}
            {!players.length ? <p className="playerCard help">Waiting for the scoreboard…</p> : null}
          </div>
          {!finished ? <div className="turnBanner" data-active={canSubmitNow}>
            <span>{autodartsControllingTurn ? autodartsTurnReady && canSubmitNow ? 'Review captured visit' : 'Autodarts scoring'
              : canSubmitNow ? 'Your turn' : currentPlayer ? `${currentPlayer.name} to throw` : 'Waiting for match'}</span>
            {checkoutSuggestion ? <span>Checkout: <strong>{checkoutSuggestion.labels.join(' · ')}</strong></span> : null}
          </div> : null}
        </section>
        {!finished && (canSubmitNow || autodartsControllingTurn) ? <MatchTurnEntry
          entryMode={entryMode} setEntryMode={setEntryMode} perDartOnly={perDartOnly}
          totalText={totalText} setTotalText={setTotalText} darts={darts} setDarts={setDarts}
          revision={entryRevision} reviewDarts={autodartsLoadedForReview?.darts}
          canSubmit={canSubmitNow} submitting={submitting} onSubmit={() => void submitTurn()} /> : null}
      </div>

      <ScoringMenu>
      {scoringTools}
      <ScoringMenuSection title="Visit history" hint={`${leg?.turns?.length ?? 0} this leg`}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="help">Recent by default; switch to see the full leg history.</div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setScoresTab('RECENT')} disabled={scoresTab === 'RECENT'}>
              Recent scores
            </button>
            <button className="btn" onClick={() => setScoresTab('ALL')} disabled={scoresTab === 'ALL'}>
              All turns
            </button>
          </div>
        </div>

        <div className="col" style={{ marginTop: 10 }}>
          <ScoresByPlayer
            tab={scoresTab}
            turns={leg?.turns ?? []}
            players={players}
            recentVisitsPerPlayer={6}
          />
        </div>
      </ScoringMenuSection>

      <ScoringMenuSection title="Player stats">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="help">{isX01 ? 'Computed from turns (total mode assumes 3 darts per visit).' : 'Practice/Around modes: darts-thrown focused stats.'}</div>
          </div>
        </div>

        <div className="col" style={{ marginTop: 10 }}>
          {players.map((p) => {
            const s = statsByPlayerId[p.id]
            if (!s) return null
            return (
              <div
                key={p.id}
                className="card"
                style={{ padding: 12, background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="pill" style={{ color: 'var(--text)' }}>{p.name}</span>
                  {!isX01 ? <span className="pill">Darts: {s.dartsThrown ?? 0}</span> : <span className="pill">Avg: {s.threeDartAvg ?? '-'}</span>}
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {isPractice ? null : match?.settings?.setsEnabled ? <span className="pill">Sets: {s.setsWon}</span> : null}
                  {isPractice ? null : <span className="pill">Legs: {s.legsWon}</span>}
                  <span className="pill">Darts thrown: {s.dartsThrown ?? 0}</span>
                  {isX01 ? <span className="pill">First 9: {s.first9Avg ?? '-'}</span> : null}
                  {isX01 ? <span className="pill">CO%: {s.checkoutRate == null ? '-' : `${s.checkoutRate}%`}</span> : null}
                  {isX01 ? <span className="pill">Hi finish: {s.highestFinish ?? '-'}</span> : null}
                  {isX01 ? <span className="pill">Hi score: {s.highestScore}</span> : null}
                  <span className="pill">Best leg: {s.bestLegDarts == null ? '-' : `${s.bestLegDarts} darts`}</span>
                  <span className="pill">Worst leg: {s.worstLegDarts == null ? '-' : `${s.worstLegDarts} darts`}</span>
                </div>
              </div>
            )
          })}
        </div>
      </ScoringMenuSection>
      </ScoringMenu>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  )
}

function lastScoreForPlayer(turns: MatchSnapshot['leg']['turns'], playerId: string): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.playerId === playerId) return t.scoreTotal
  }
  return null
}

function dartsThrownForPlayer(turns: MatchSnapshot['leg']['turns'], playerId: string): number {
  let sum = 0
  for (const t of turns) {
    if (t.playerId !== playerId) continue
    if (t.input?.mode === 'PER_DART' && Array.isArray(t.input.darts)) sum += t.input.darts.length
    else if (t.input?.mode === 'TOTAL' && Array.isArray(t.input.darts)) sum += t.input.darts.length
    else sum += 3
  }
  return sum
}

function MatchTurnEntry({
  entryMode,
  setEntryMode,
  revision,
  reviewDarts,
  perDartOnly,
  totalText,
  setTotalText,
  darts,
  setDarts,
  canSubmit,
  submitting,
  onSubmit,
}: {
  entryMode: 'TOTAL' | 'PER_DART'
  setEntryMode: (m: 'TOTAL' | 'PER_DART') => void
  revision: number
  reviewDarts?: Dart[]
  perDartOnly: boolean
  totalText: string
  setTotalText: (t: string) => void
  darts: Dart[]
  setDarts: (d: Dart[]) => void
  canSubmit: boolean
  submitting: boolean
  onSubmit: () => void
}) {
  const totalFromDarts = darts.reduce((acc, d) => acc + dartPoints(d), 0)
  const totalMode = entryMode === 'TOTAL' && !perDartOnly
  const scoreInvalid = totalMode && Number(totalText) > 180

  function setDigit(d: string) {
    setTotalText((totalText + d).replace(/^0+(?=\d)/, '').slice(0, 3))
  }

  return (
    <fieldset className="card turnEntry" disabled={!canSubmit} aria-busy={submitting}>
      <legend className="srOnly">Enter visit</legend>
      <div className="entryBar">
        <span className="entryTitle">Enter visit</span>
        <div className="row" role="group" aria-label="Scoring input">
          {!perDartOnly ? <button className="btn" aria-pressed={totalMode} onClick={() => setEntryMode('TOTAL')}>Total</button> : null}
          <button className="btn" aria-pressed={!totalMode} onClick={() => setEntryMode('PER_DART')}>Per dart</button>
        </div>
      </div>
      <div className="entryDisplay">
        {totalMode ? <>
          <label htmlFor="visit-score" className={scoreInvalid ? 'entryHint invalidScore' : 'entryHint'}>{scoreInvalid ? 'Enter 0–180' : 'Visit score'}</label>
          <input id="visit-score" className="entryScore" inputMode="none" autoComplete="off" placeholder="0"
            value={totalText} readOnly={submitting} aria-invalid={scoreInvalid}
            onChange={(event) => setTotalText(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            onKeyDown={(event) => { if (event.key === 'Enter' && canSubmit && !scoreInvalid && !submitting) onSubmit() }} />
        </> : <><span className="entryHint">Visit score</span><output className="entryScore">{totalFromDarts}</output></>}
      </div>

      {totalMode ? (
          <div className="padGrid">
            {['1','2','3','4','5','6','7','8','9'].map((n) => (
              <button key={n} className="padKey" onClick={() => setDigit(n)}>
                {n}
              </button>
            ))}
            <button className="padKey padKeyAlt" onClick={() => setTotalText('')}>Clear</button>
            <button className="padKey" onClick={() => setDigit('0')}>0</button>
            <button className="padKey padKeyAlt" aria-label="Delete last digit" onClick={() => setTotalText(totalText.slice(0, -1))}>⌫</button>
          </div>
      ) : <DartKeypad darts={darts} onChange={setDarts} revision={revision} reviewDarts={reviewDarts} />}
      <button className="btn btnPrimary entrySubmit" onClick={onSubmit} disabled={!canSubmit || scoreInvalid || submitting}>{submitting ? 'Submitting…' : 'Submit visit'}</button>
    </fieldset>
  )
}

function dartPoints(d: Dart): number {
  if (d.multiplier === 0) return 0
  if (d.segment === 25) return d.multiplier === 2 ? 50 : 25
  return d.segment * d.multiplier
}

function dartToLabel(d: Dart): string {
  if (d.multiplier === 0) return 'MISS'
  if (d.segment === 25) return d.multiplier === 2 ? 'DB' : 'SB'
  if (d.multiplier === 3) return `T${d.segment}`
  if (d.multiplier === 2) return `D${d.segment}`
  return `${d.segment}`
}

function sameDarts(a: Dart[], b: Dart[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (!x || !y) return false
    if (x.segment !== y.segment || x.multiplier !== y.multiplier) return false
  }
  return true
}

function toEditorDarts(input: Dart[]): Dart[] {
  if (!Array.isArray(input) || input.length < 1) return []
  const out: Dart[] = [
    { segment: 0, multiplier: 0 },
    { segment: 0, multiplier: 0 },
    { segment: 0, multiplier: 0 },
  ]
  for (let i = 0; i < 3; i++) {
    const d = input[i]
    if (!d) continue
    out[i] = { segment: d.segment, multiplier: d.multiplier }
  }
  return out
}

function parseVoiceTurn(input: string): Dart[] | null {
  const txt = input
    .toLowerCase()
    .replaceAll(',', ' ')
    .replaceAll('-', ' ')
    .replaceAll('.', ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!txt) return null

  const words = txt.split(' ')
  const darts: Dart[] = []
  let i = 0

  while (i < words.length && darts.length < 3) {
    const w = words[i]
    const next = words[i + 1]

    if (isMissWord(w)) {
      darts.push({ segment: 0, multiplier: 0 })
      i += 1
      continue
    }

    if (isSingleWord(w) && isSegmentWord(next)) {
      darts.push({ segment: Number(next), multiplier: 1 })
      i += 2
      continue
    }
    if (isDoubleWord(w) && isSegmentWord(next)) {
      darts.push({ segment: Number(next), multiplier: 2 })
      i += 2
      continue
    }
    if (isTripleWord(w) && isSegmentWord(next)) {
      darts.push({ segment: Number(next), multiplier: 3 })
      i += 2
      continue
    }

    if (isDoubleWord(w) && isBullWord(next, false)) {
      darts.push({ segment: 25, multiplier: 2 })
      i += 2
      continue
    }
    if (isSingleWord(w) && isBullWord(next, false)) {
      darts.push({ segment: 25, multiplier: 1 })
      i += 2
      continue
    }
    if (isBullWord(w, false)) {
      darts.push({ segment: 25, multiplier: 1 })
      i += 1
      continue
    }
    if (isBullWord(w, true)) {
      darts.push({ segment: 25, multiplier: 2 })
      i += 1
      continue
    }

    if (/^[sdt]\d{1,2}$/.test(w)) {
      const mult = w[0] === 's' ? 1 : w[0] === 'd' ? 2 : 3
      const seg = Number(w.slice(1))
      if (seg >= 1 && seg <= 20) {
        darts.push({ segment: seg, multiplier: mult as 1 | 2 | 3 })
        i += 1
        continue
      }
    }

    i += 1
  }

  return darts.length > 0 ? darts : null
}

function parseVoiceScore180(input: string): number | null {
  const txt = input
    .toLowerCase()
    .replaceAll(',', ' ')
    .replaceAll('-', ' ')
    .replaceAll('.', ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!txt) return null

  const normalized = normalizeSpokenNumberText(txt)
  const content = stripVoiceCommandWords(normalized)
  if (!content) return null

  const direct = Number(content)
  if (Number.isInteger(direct) && direct >= 0 && direct <= 180) return direct

  const numberInText = content.match(/\b(\d{1,3})\b/)
  if (numberInText) {
    const n = Number(numberInText[1])
    if (Number.isInteger(n) && n >= 0 && n <= 180) return n
  }

  const english = parseEnglishNumber(content)
  if (english != null && english >= 0 && english <= 180) return english

  return null
}

function normalizeSpokenNumberText(input: string): string {
  return input
    .replace(/\bto\b/g, 'two')
    .replace(/\btoo\b/g, 'two')
    .replace(/\bfor\b/g, 'four')
    .replace(/\bfore\b/g, 'four')
    .replace(/\bwon\b/g, 'one')
    .replace(/\btree\b/g, 'three')
    .replace(/\bsex\b/g, 'six')
    .replace(/\bsics\b/g, 'six')
    .replace(/\bsick\b/g, 'six')
    .replace(/\bsicks\b/g, 'six')
    .replace(/\bsis\b/g, 'six')
}

function parseVoiceSubmitIntent(input: string): boolean {
  const txt = input
    .toLowerCase()
    .replaceAll(',', ' ')
    .replaceAll('-', ' ')
    .replaceAll('.', ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!txt) return false
  return /\b(submit|send|enter|confirm|done|next|ok|okay|go)\b/.test(txt)
}

function parseVoiceMissIntent(input: string): boolean {
  const txt = input
    .toLowerCase()
    .replaceAll(',', ' ')
    .replaceAll('-', ' ')
    .replaceAll('.', ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!txt) return false
  return /\b(miss|missed)\b/.test(txt)
}

function parseVoiceCheckIntent(input: string): boolean {
  const txt = input
    .toLowerCase()
    .replaceAll(',', ' ')
    .replaceAll('-', ' ')
    .replaceAll('.', ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!txt) return false
  return /\b(check|checkout|check out)\b/.test(txt)
}

function stripVoiceCommandWords(input: string): string {
  return input
    .replace(/\b(submit|send|enter|confirm|done|next|ok|okay|go|score|points|point)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseEnglishNumber(input: string): number | null {
  const units: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  }
  const tens: Record<string, number> = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  }

  const words = input
    .split(' ')
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => w !== 'and')

  if (words.length === 0) return null

  let total = 0
  let current = 0
  for (const w of words) {
    if (w in units) {
      current += units[w]
      continue
    }
    if (w in tens) {
      current += tens[w]
      continue
    }
    if (w === 'hundred') {
      if (current === 0) current = 1
      current *= 100
      continue
    }
    return null
  }

  total += current
  return Number.isInteger(total) ? total : null
}

async function playTurnCallout(
  evt: any,
  lang: VoiceLang,
  activeAudioRef: { current: HTMLAudioElement | null },
  missingAudioRef: { current: Set<string> },
): Promise<void> {
  const text = buildTurnCallout(evt, lang)
  if (!text) return

  const key = buildTurnCalloutAudioKey(evt)
  if (key) {
    const played = await tryPlayCalloutAudio(key, lang, activeAudioRef, missingAudioRef)
    if (played) return
  }

  await speakCallout(text, lang)
}

async function playCheckoutReminderCallout(
  remaining: number,
  lang: VoiceLang,
  activeAudioRef: { current: HTMLAudioElement | null },
  missingAudioRef: { current: Set<string> },
): Promise<void> {
  if (!Number.isInteger(remaining) || remaining <= 1) return
  const played = await playCalloutAudioSequence(['you_require', `${remaining}`], lang, activeAudioRef, missingAudioRef)
  if (played) return
  const text = buildCheckoutReminder(remaining, lang)
  if (text) await speakCallout(text, lang)
}

function buildTurnCalloutAudioKey(evt: any): string | null {
  if (!evt || typeof evt !== 'object') return null
  const score = Number(evt.score)
  const isBust = Boolean(evt.isBust)
  const didCheckout = Boolean(evt.didCheckout)
  const matchFinished = Boolean(evt.matchFinished)
  const finishedLegNumber = Number(evt.finishedLegNumber)
  const finishedSetNumber = Number(evt.finishedSetNumber)

  if (didCheckout && matchFinished) return 'game-shot-match'
  if (
    didCheckout &&
    Number.isInteger(finishedSetNumber) &&
    finishedSetNumber > 0 &&
    Number.isInteger(finishedLegNumber) &&
    finishedLegNumber > 0
  ) {
    return `game-shot-set-leg-${finishedSetNumber}-${finishedLegNumber}`
  }
  if (didCheckout && Number.isInteger(finishedLegNumber) && finishedLegNumber > 0 && finishedLegNumber <= 20) {
    return `game-shot-leg-${finishedLegNumber}`
  }
  if (didCheckout) return 'game-shot'
  if (isBust) return 'bust'
  if (Number.isInteger(score) && score >= 0 && score <= 180) return `score-${score}`
  return null
}

async function tryPlayCalloutAudio(
  key: string,
  lang: VoiceLang,
  activeAudioRef: { current: HTMLAudioElement | null },
  missingAudioRef: { current: Set<string> },
): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (activeAudioRef.current) {
    activeAudioRef.current.pause()
    activeAudioRef.current.currentTime = 0
  }
  const audio = await resolveCalloutAudio(key, lang, missingAudioRef)
  if (!audio) return false
  try {
    activeAudioRef.current = audio
    await audio.play()
    await waitForAudioEnd(audio)
    return true
  } catch {
    return false
  }
}

async function playCalloutAudioSequence(
  keys: string[],
  lang: VoiceLang,
  activeAudioRef: { current: HTMLAudioElement | null },
  missingAudioRef: { current: Set<string> },
): Promise<boolean> {
  if (typeof window === 'undefined' || keys.length === 0) return false
  if (activeAudioRef.current) {
    activeAudioRef.current.pause()
    activeAudioRef.current.currentTime = 0
  }

  for (const key of keys) {
    const audio = await resolveCalloutAudio(key, lang, missingAudioRef)
    if (!audio) return false
    try {
      activeAudioRef.current = audio
      await audio.play()
      await waitForAudioEnd(audio)
    } catch {
      return false
    }
  }
  return true
}

async function resolveCalloutAudio(
  key: string,
  lang: VoiceLang,
  missingAudioRef: { current: Set<string> },
): Promise<HTMLAudioElement | null> {
  const langFolder = lang.toLowerCase()
  const keys = expandAudioKeyCandidates(key)

  for (const candidate of keys) {
    const src = `/audio/callouts/${langFolder}/${candidate}.mp3`
    if (missingAudioRef.current.has(src)) continue

    const audio = new Audio(src)
    audio.preload = 'metadata'
    audio.crossOrigin = 'anonymous'

    const exists = await waitForAudioLoad(audio)
    if (!exists) {
      missingAudioRef.current.add(src)
      continue
    }

    return audio
  }

  return null
}

function expandAudioKeyCandidates(key: string): string[] {
  const keys = new Set<string>([key])
  if (key === 'bust') keys.add('busted')
  if (key === 'game-shot-match') keys.add('matchshot')
  if (key === 'game-shot') keys.add('gameshot')
  const setLegKey = key.match(/^game-shot-set-leg-(\d{1,2})-(\d{1,2})$/)
  if (setLegKey) {
    const setNo = Number(setLegKey[1])
    const legNo = Number(setLegKey[2])
    keys.add(`s${setNo}_l${legNo}_n`)
    keys.add(`gameshot_l${legNo}_n`)
    keys.add(`set_${setNo}`)
    keys.add(`leg_${legNo}`)
  }
  const legKey = key.match(/^game-shot-leg-(\d{1,2})$/)
  if (legKey) {
    const legNo = Number(legKey[1])
    keys.add(`gameshot_l${legNo}_n`)
    keys.add(`leg_${legNo}`)
  }
  if (key.startsWith('score-')) {
    const score = key.slice('score-'.length)
    if (/^\d+$/.test(score)) keys.add(score)
  }
  return Array.from(keys)
}

function waitForAudioLoad(audio: HTMLAudioElement): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      cleanup()
      resolve(ok)
    }
    const cleanup = () => {
      audio.onloadedmetadata = null
      audio.oncanplay = null
      audio.onerror = null
      clearTimeout(timeout)
    }
    const timeout = setTimeout(() => finish(false), 1200)
    audio.onloadedmetadata = () => finish(true)
    audio.oncanplay = () => finish(true)
    audio.onerror = () => finish(false)
    audio.load()
  })
}

function waitForAudioEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      cleanup()
      if (ok) resolve()
      else reject(new Error('AUDIO_END_FAILED'))
    }
    const cleanup = () => {
      audio.onended = null
      audio.onerror = null
      clearTimeout(timeout)
    }
    const timeout = setTimeout(() => finish(false), 8000)
    audio.onended = () => finish(true)
    audio.onerror = () => finish(false)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildTurnCallout(evt: any, lang: VoiceLang): string | null {
  if (!evt || typeof evt !== 'object') return null
  const score = Number(evt.score)
  const isBust = Boolean(evt.isBust)
  const didCheckout = Boolean(evt.didCheckout)
  const matchFinished = Boolean(evt.matchFinished)
  const finishedLegNumber = Number(evt.finishedLegNumber)

  if (didCheckout) {
    if (matchFinished) {
      if (lang === 'NL') return 'Game shot en de wedstrijd.'
      if (lang === 'DE') return 'Game shot und das Match.'
      return 'Game shot and the match.'
    }
    if (Number.isInteger(finishedLegNumber) && finishedLegNumber > 0) {
      if (lang === 'NL') return `Game shot en de ${ordinalWord(finishedLegNumber, lang)} leg.`
      if (lang === 'DE') return `Game shot und das ${ordinalWord(finishedLegNumber, lang)} Leg.`
      return `Game shot and the ${ordinalWord(finishedLegNumber, lang)} leg.`
    }
    if (lang === 'NL') return 'Game shot.'
    if (lang === 'DE') return 'Game shot.'
    return 'Game shot.'
  }

  if (isBust) {
    if (lang === 'NL') return 'Busted.'
    if (lang === 'DE') return 'Bust.'
    return 'Bust.'
  }
  if (Number.isInteger(score) && score >= 0 && score <= 180) return `${score}.`
  return null
}

function buildCheckoutReminder(remaining: number, lang: VoiceLang): string | null {
  if (!Number.isInteger(remaining) || remaining <= 1) return null
  if (lang === 'NL') return `Je hebt ${remaining} nodig.`
  if (lang === 'DE') return `Du brauchst ${remaining}.`
  return `You require ${remaining}.`
}

function speakCallout(text: string, lang: VoiceLang): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const synth = (window as any).speechSynthesis
  const Ctor = (window as any).SpeechSynthesisUtterance
  if (!synth || !Ctor) return Promise.resolve()
  const utter = new Ctor(text)
  utter.lang = lang === 'NL' ? 'nl-NL' : lang === 'DE' ? 'de-DE' : 'en-US'
  utter.rate = 1
  utter.pitch = 1
  utter.volume = 1
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      utter.onend = null
      utter.onerror = null
      resolve()
    }
    utter.onend = finish
    utter.onerror = finish
    synth.speak(utter)
    window.setTimeout(finish, 5000)
  })
}

function ordinalWord(n: number, lang: VoiceLang): string {
  if (lang === 'NL') {
    const words: Record<number, string> = {
      1: 'eerste',
      2: 'tweede',
      3: 'derde',
      4: 'vierde',
      5: 'vijfde',
      6: 'zesde',
      7: 'zevende',
      8: 'achtste',
      9: 'negende',
      10: 'tiende',
    }
    return words[n] ?? `${n}e`
  }
  if (lang === 'DE') {
    const words: Record<number, string> = {
      1: 'erste',
      2: 'zweite',
      3: 'dritte',
      4: 'vierte',
      5: 'fuenfte',
      6: 'sechste',
      7: 'siebte',
      8: 'achte',
      9: 'neunte',
      10: 'zehnte',
    }
    return words[n] ?? `${n}.`
  }

  const words: Record<number, string> = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
    13: 'thirteenth',
    14: 'fourteenth',
    15: 'fifteenth',
  }
  if (words[n]) return words[n]
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n}st`
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`
  return `${n}th`
}

function isMissWord(word: string): boolean {
  return ['miss', 'm', 'fehlwurf', 'daneben', 'mis', 'gemist'].includes(word)
}

function isSingleWord(word: string): boolean {
  return ['single', 's', 'einfach', 'enkel', 'los'].includes(word)
}

function isDoubleWord(word: string): boolean {
  return ['double', 'd', 'dubbel', 'doppel'].includes(word)
}

function isTripleWord(word: string): boolean {
  return ['triple', 'treble', 't', 'trippel', 'dreifach'].includes(word)
}

function isBullWord(word: string | undefined, double: boolean): boolean {
  if (!word) return false
  if (double) {
    return ['bullseye', 'db', 'doppelbull', 'rood', 'redbull'].includes(word)
  }
  return ['bull', 'sb', 'bulls', 'groen', 'greenbull'].includes(word)
}

function isSegmentWord(word?: string): boolean {
  if (!word) return false
  const n = Number(word)
  return Number.isInteger(n) && n >= 1 && n <= 20
}

function canSubmitForCurrent(code: string, currentPlayerId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const key = `dc_controlled_${code.toUpperCase()}`
    const ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    return ids.includes(currentPlayerId)
  } catch {
    return false
  }
}

function rememberControlledPlayer(code: string, playerId: string): void {
  try {
    const key = `dc_controlled_${code.toUpperCase()}`
    const ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    if (!ids.includes(playerId)) localStorage.setItem(key, JSON.stringify([...ids, playerId]))
  } catch {
    localStorage.setItem(`dc_controlled_${code.toUpperCase()}`, JSON.stringify([playerId]))
  }
}

function voiceRecognitionErrorMessage(error?: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Speech recognition was blocked. Allow microphone and speech access in browser settings.'
  }
  if (error === 'audio-capture') return 'No working microphone was found.'
  if (error === 'network') return 'The browser speech service is unavailable. Opera GX may not support it.'
  if (error === 'no-speech') return 'No speech was detected. Try again and speak closer to the microphone.'
  return 'Voice capture failed in this browser.'
}

function PlayerPanel({
  player,
  isCurrent,
  leg,
  settings,
  match,
  stats,
}: {
  player: Player
  isCurrent: boolean
  leg: MatchSnapshot['leg'] | undefined
  settings: MatchSnapshot['settings'] | undefined
  match: MatchSnapshot | undefined
  stats: PlayerStats | undefined
}) {
  const ps = leg?.players?.find((x) => x.playerId === player.id)
  const last = lastScoreForPlayer(leg?.turns ?? [], player.id)
  const thrown = dartsThrownForPlayer(leg?.turns ?? [], player.id)

  return (
    <article className="playerCard" data-current={isCurrent} aria-label={player.name}>
      <div className="scoreCardHeader"><strong className="scoreName">{player.name}</strong>{isCurrent ? <span className="scoreTurn">Throwing</span> : null}</div>
      <div className="playerBigNum">{ps?.remaining ?? '–'}</div>
      <div className="scoreMeta">
        {match?.settings?.gameType === 'PRACTICE' ? <span>{stats?.dartsThrown ?? thrown} darts</span> : <span>{stats?.legsWon ?? 0} legs</span>}
        {match?.settings?.setsEnabled ? <span>{stats?.setsWon ?? 0} sets</span> : null}
        {settings?.gameType === 'X01' && settings.doubleIn && !ps?.isIn ? <span>Not in</span> : null}
        <span>Last {last ?? '–'}</span>
      </div>
    </article>
  )
}

function ScoresByPlayer({
  tab,
  turns,
  players,
  recentVisitsPerPlayer,
}: {
  tab: 'RECENT' | 'ALL'
  turns: MatchSnapshot['leg']['turns']
  players: Player[]
  recentVisitsPerPlayer: number
}) {
  if (!players || players.length === 0) return <div className="help">No players.</div>
  if (!turns || turns.length === 0) return <div className="help">No turns yet.</div>

  const byPlayerId: Record<string, MatchSnapshot['leg']['turns']> = {}
  for (const p of players) byPlayerId[p.id] = []
  for (const t of turns) {
    if (byPlayerId[t.playerId]) byPlayerId[t.playerId].push(t)
  }

  return (
    <div className="gridAuto">
      {players.map((p) => {
        const myTurns = byPlayerId[p.id] ?? []

        const visits = myTurns.map((t, idx) => {
          const visitNo = idx + 1
          return {
            id: t.id,
            dartsAfter: visitNo * 3,
            score: t.scoreTotal,
            remainingBefore: t.remainingBefore,
            remainingAfter: t.remainingAfter,
            isBust: t.isBust,
            didCheckout: t.didCheckout,
          }
        })

        const shown = tab === 'RECENT' ? visits.slice(-recentVisitsPerPlayer) : visits

        return (
          <div
            key={p.id}
            className="card"
            style={{ padding: 14, background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="pill" style={{ color: 'var(--text)' }}>{p.name}</span>
              <span className="pill">Visits: {visits.length}</span>
            </div>

            <div className="col" style={{ gap: 8, marginTop: 10 }}>
              {shown.length === 0 ? (
                <div className="help">No scores yet.</div>
              ) : (
                shown
                  .slice()
                  .reverse()
                  .map((v) => (
                    <div
                      key={v.id}
                      className="row"
                      style={{
                        justifyContent: 'space-between',
                        padding: 10,
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.10)',
                        background: v.isBust ? 'rgba(255,90,107,0.10)' : 'rgba(0,0,0,0.10)',
                      }}
                    >
                      <div className="row" style={{ flexWrap: 'wrap' }}>
                        <span className="pill">{v.dartsAfter} darts</span>
                        <span className="pill">{v.score}</span>
                        {v.isBust ? <span className="pill" style={{ color: 'var(--bad)' }}>BUST</span> : null}
                        {v.didCheckout ? <span className="pill" style={{ color: 'var(--good)' }}>OUT</span> : null}
                      </div>
                      <span className="pill">Rem: {v.remainingAfter}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
