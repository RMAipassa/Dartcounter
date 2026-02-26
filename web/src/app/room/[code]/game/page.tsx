'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type { Dart, MatchSnapshot, Player, PlayerStats, RoomSnapshot } from '@/lib/types'
import { suggestCheckout, type OutRule } from '@/lib/checkout'

type VoiceLang = 'EN' | 'NL' | 'DE'

export default function GamePage() {
  const params = useParams<{ code: string }>()
  const code = (params.code ?? '').toUpperCase()
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [snap, setSnap] = useState<RoomSnapshot | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [total, setTotal] = useState<number>(60)
  const [totalText, setTotalText] = useState<string>('60')
  const [entryMode, setEntryMode] = useState<'TOTAL' | 'PER_DART'>('TOTAL')
  const [darts, setDarts] = useState<Dart[]>([
    { segment: 20, multiplier: 1 },
    { segment: 20, multiplier: 1 },
    { segment: 20, multiplier: 1 },
  ])

  const [needDarts, setNeedDarts] = useState<null | 'DOUBLE_IN'>(null)
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
  const voiceLang: VoiceLang = 'EN'
  const [hostSecret, setHostSecret] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const missingBoardNoticeKeyRef = useRef('')
  const speechRef = useRef<any>(null)
  const voiceAlwaysOnRef = useRef(false)
  const voiceManualStopRef = useRef(false)
  const finishedRef = useRef(false)
  const lastCheckoutReminderKeyRef = useRef('')
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve())
  const activeCalloutAudioRef = useRef<HTMLAudioElement | null>(null)
  const missingCalloutAudioRef = useRef<Set<string>>(new Set())

  const enqueueCalloutPlayback = useCallback((job: () => Promise<void> | void) => {
    playbackQueueRef.current = playbackQueueRef.current
      .then(() => Promise.resolve(job()))
      .catch(() => undefined)
    return playbackQueueRef.current
  }, [])

  useEffect(() => {
    const next = String(total)
    if (totalText !== next) setTotalText(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

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
      if (!res?.ok) setToast(res?.message ?? 'Failed to join')
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
  finishedRef.current = Boolean(finished)
  voiceAlwaysOnRef.current = voiceAlwaysOn
  const statsByPlayerId = match?.statsByPlayerId ?? {}
  const autodarts = snap?.room?.autodarts
  const autodartsActiveUserId = snap?.room?.autodartsActiveUserId ?? null
  const autodartsActivePlayerName = autodartsActiveUserId
    ? (snap?.clients ?? []).find((c) => c.userId === autodartsActiveUserId)?.name ?? null
    : null
  const isHost = Boolean(hostSecret)
  const autodartsBufferPlayerName = autodartsBufferPlayerId
    ? players.find((p) => p.id === autodartsBufferPlayerId)?.name ?? null
    : null
  const canSubmitByControl = hydrated && currentPlayer ? canSubmitForCurrent(code, currentPlayer.id) : false
  const canClearAutodartsPending =
    autodartsBuffer.length > 0 &&
    (isHost || (hydrated && autodartsBufferPlayerId ? canSubmitForCurrent(code, autodartsBufferPlayerId) : false))
  const autodartsControllingTurn =
    Boolean(currentPlayer?.id) &&
    autodarts?.status === 'CONNECTED' &&
    autodartsBuffer.length > 0 &&
    autodartsBufferPlayerId === currentPlayer?.id
  const autodartsTurnReady = autodartsControllingTurn && autodartsBufferReady
  const canSubmitNow = canSubmitByControl && (!autodartsControllingTurn || autodartsTurnReady)
  const autodartsPerDartOnly = autodarts?.status === 'CONNECTED'
  const autodartsReviewEdited =
    Boolean(autodartsLoadedForReview) &&
    (entryMode !== 'PER_DART' || !sameDarts(darts, autodartsLoadedForReview?.darts ?? []))

  const currentLegPlayer = currentPlayer ? leg?.players?.find((p) => p.playerId === currentPlayer.id) : null
  const outRule: OutRule = settings?.doubleOut ? 'DOUBLE' : settings?.masterOut ? 'MASTER' : 'ANY'
  const checkoutMax = outRule === 'MASTER' ? 180 : 170
  const checkoutSuggestion =
    currentLegPlayer &&
    currentLegPlayer.isIn &&
    currentLegPlayer.remaining <= checkoutMax &&
    currentLegPlayer.remaining > 1
      ? suggestCheckout({ remaining: currentLegPlayer.remaining, outRule })
      : null

  const isMobile = useMediaQuery('(max-width: 520px)')
  const showOnlyCurrent = players.length > 3
  const visiblePlayers = showOnlyCurrent && currentPlayer ? [currentPlayer] : players

  const [scoresTab, setScoresTab] = useState<'RECENT' | 'ALL'>('RECENT')

  useEffect(() => {
    if (!autodartsPerDartOnly) return
    if (entryMode !== 'PER_DART') setEntryMode('PER_DART')
  }, [autodartsPerDartOnly, entryMode])

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
    withDarts?: boolean,
    override?: { mode?: 'TOTAL' | 'PER_DART'; total?: number; darts?: Dart[] },
  ) {
    try {
      setToast(null)
      const submittingAutodartsSuggestion = autodartsTurnReady
      const socket = getSocket(serverUrl)
      const payload: any = {}

      const mode = override?.mode ?? entryMode
      if (mode === 'PER_DART') {
        payload.darts = override?.darts ?? darts
      } else {
        payload.total = typeof override?.total === 'number' ? override.total : total
        if (withDarts) payload.darts = override?.darts ?? darts
      }

      const res = await socket.emitWithAck('game:submitTurn', payload)
      if (!res?.ok) {
        if (res?.code === 'NEED_DARTS_FOR_DOUBLE_IN') setNeedDarts('DOUBLE_IN')
        if (res?.code === 'AUTODARTS_PER_DART_ONLY') setEntryMode('PER_DART')
        throw new Error(res?.message ?? 'Failed')
      }
      setNeedDarts(null)
      if (submittingAutodartsSuggestion) {
        setAutodartsLoadedForReview(null)
      }
    } catch (e: any) {
      setToast(e?.message ?? String(e))
      setTimeout(() => setToast(null), 2500)
    }
  }

  useEffect(() => {
    if (!voiceSupported) return
    if (finished) {
      if (voiceListening) {
        voiceManualStopRef.current = true
        speechRef.current?.stop?.()
      }
      return
    }
    if (voiceAlwaysOn && !voiceListening) {
      voiceManualStopRef.current = false
      startVoiceInput()
    }
    if (!voiceAlwaysOn && voiceListening && voiceManualStopRef.current) {
      speechRef.current?.stop?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAlwaysOn, voiceSupported, finished])

  function toggleVoiceInput() {
    if (!voiceSupported || typeof window === 'undefined') {
      setToast('Voice input not supported in this browser')
      setTimeout(() => setToast(null), 1800)
      return
    }

    if (voiceListening) {
      setVoiceAlwaysOn(false)
      voiceManualStopRef.current = true
      speechRef.current?.stop?.()
      setVoiceListening(false)
      return
    }

    voiceManualStopRef.current = false
    startVoiceInput()
  }

  function startVoiceInput() {
    if (!voiceSupported || typeof window === 'undefined' || finishedRef.current) return

    const ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new ctor()
    speechRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setVoiceListening(true)
      setToast('Listening... say e.g. "triple 20" / "trippel 20" / "dreifach 20"')
      setTimeout(() => setToast(null), 2000)
    }

    rec.onend = () => {
      setVoiceListening(false)
      speechRef.current = null
      if (voiceAlwaysOnRef.current && !voiceManualStopRef.current && !finishedRef.current) {
        window.setTimeout(() => startVoiceInput(), 220)
      }
    }

    rec.onerror = () => {
      setVoiceListening(false)
      speechRef.current = null
      setToast('Voice capture failed')
      setTimeout(() => setToast(null), 1800)
    }

    rec.onresult = (evt: any) => {
      const transcript = String(evt?.results?.[0]?.[0]?.transcript ?? '').trim()
      setVoiceLastTranscript(transcript)
      const shouldSubmit = parseVoiceSubmitIntent(transcript)
      const parsed = parseVoiceTurn(transcript)
      if (parsed) {
        setEntryMode('PER_DART')
        setDarts(toEditorDarts(parsed))
        setToast(`Voice captured: ${parsed.map((d: Dart) => dartToLabel(d)).join(', ')}`)
        setTimeout(() => setToast(null), 1800)
        if (shouldSubmit) {
          void submitTurn(false, { mode: 'PER_DART', darts: toEditorDarts(parsed) })
        }
        return
      }

      const score = parseVoiceScore180(transcript)
      if (score != null) {
        setEntryMode('TOTAL')
        setTotal(score)
        setTotalText(String(score))
        setToast(`Voice score: ${score}`)
        setTimeout(() => setToast(null), 1800)
        if (shouldSubmit) {
          void submitTurn(false, { mode: 'TOTAL', total: score })
        }
        return
      }

      if (shouldSubmit) {
        void submitTurn(false)
        setToast('Submitted current turn')
        setTimeout(() => setToast(null), 1800)
        return
      }

      setToast('Could not parse voice input')
      setTimeout(() => setToast(null), 1800)
    }

    rec.start()
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="desktopOnly">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="title">Game</h1>
            <p className="subtitle">
              {settings ? (
                <span className="pill">
                  {settings.startScore} · {settings.doubleIn ? 'DI' : 'SI'} · {settings.doubleOut ? 'DO' : settings.masterOut ? 'MO' : 'SO'}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </div>

      <div className="desktopOnly">
      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="pill">Autodarts: {autodarts?.status ?? 'DISCONNECTED'}</span>
            <span className="pill">Device: {autodarts?.deviceId ?? 'none'}</span>
            <span className="pill">Active player board: {autodartsActivePlayerName ?? 'none'}</span>
            {autodartsPerDartOnly ? <span className="pill" style={{ color: 'var(--accent)' }}>Per-dart only</span> : null}
            {autodartsLastDart ? <span className="pill">Last dart: {dartToLabel(autodartsLastDart)}</span> : null}
            <button className="btn" onClick={toggleVoiceInput} disabled={!voiceSupported || finished}>
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
              <span className="pill" style={{ color: autodartsReviewEdited ? '#ffd88a' : 'var(--good)' }}>
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
      </div>
      </div>

      <div className="mobileOnly fullBleed">
        <MobileGame
          code={code}
          match={match}
          leg={leg}
          players={players}
          currentPlayer={currentPlayer}
          statsByPlayerId={statsByPlayerId}
          checkoutSuggestion={checkoutSuggestion}
          canSubmit={canSubmitNow}
          autodartsControllingTurn={autodartsControllingTurn}
          autodartsTurnReady={autodartsTurnReady}
          autodartsBaselineDarts={autodartsLoadedForReview?.darts ?? null}
          perDartOnly={autodartsPerDartOnly}
          onSubmit={submitTurn}
          entryMode={entryMode}
          setEntryMode={setEntryMode}
          totalText={totalText}
          setTotalText={setTotalText}
          total={total}
          setTotal={setTotal}
          darts={darts}
          setDarts={setDarts}
          onVoiceInput={toggleVoiceInput}
          voiceAlwaysOn={voiceAlwaysOn}
          setVoiceAlwaysOn={setVoiceAlwaysOn}
          voiceSupported={voiceSupported}
          voiceListening={voiceListening}
          finished={finished}
        />
      </div>

      <div className="desktopOnly">
        <div className="grid2">
          <div className="card" style={{ padding: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, marginBottom: 6 }}>Scoreboard</div>
                <div className="help">{showOnlyCurrent ? 'Showing current player only.' : 'Each player has their own table.'}</div>
              </div>
              {match ? <span className="pill">Set {match.currentSetNumber} · Leg {match.currentLeg.legNumber}</span> : null}
            </div>

            <div className={showOnlyCurrent ? 'col' : 'grid3'} style={{ marginTop: 10 }}>
              {visiblePlayers.map((p) => (
                <PlayerPanel
                  key={p.id}
                  player={p}
                  isCurrent={p.id === currentPlayer?.id}
                  leg={leg}
                  settings={settings}
                  match={match}
                  stats={statsByPlayerId[p.id]}
                  autodartsControllingTurn={autodartsControllingTurn && p.id === currentPlayer?.id}
                />
              ))}
            </div>
          </div>

          <EnterTurnCard
            currentPlayer={currentPlayer}
            checkoutSuggestion={checkoutSuggestion}
            entryMode={entryMode}
            setEntryMode={setEntryMode}
            darts={darts}
            setDarts={setDarts}
            totalText={totalText}
            setTotalText={setTotalText}
            total={total}
            setTotal={setTotal}
            needDarts={needDarts}
            setNeedDarts={setNeedDarts}
            submitTurn={submitTurn}
            settings={settings}
            finished={finished}
            canSubmit={canSubmitNow}
            autodartsControllingTurn={autodartsControllingTurn}
            autodartsTurnReady={autodartsTurnReady}
            perDartOnly={autodartsPerDartOnly}
          />
        </div>
      </div>

      <div className="desktopOnly">
        <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, marginBottom: 6 }}>Scores</div>
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
            players={showOnlyCurrent ? visiblePlayers : players}
            recentVisitsPerPlayer={6}
          />
        </div>
      </div>

        <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, marginBottom: 6 }}>Player stats</div>
            <div className="help">Computed from turns (total mode assumes 3 darts per visit).</div>
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
                  <span className="pill">Avg: {s.threeDartAvg ?? '-'}</span>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {match?.settings?.setsEnabled ? <span className="pill">Sets: {s.setsWon}</span> : null}
                  <span className="pill">Legs: {s.legsWon}</span>
                  <span className="pill">First 9: {s.first9Avg ?? '-'}</span>
                  <span className="pill">CO%: {s.checkoutRate == null ? '-' : `${s.checkoutRate}%`}</span>
                  <span className="pill">Hi finish: {s.highestFinish ?? '-'}</span>
                  <span className="pill">Hi score: {s.highestScore}</span>
                  <span className="pill">Best leg: {s.bestLegDarts == null ? '-' : `${s.bestLegDarts} darts`}</span>
                  <span className="pill">Worst leg: {s.worstLegDarts == null ? '-' : `${s.worstLegDarts} darts`}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

function MobileGame({
  code,
  match,
  leg,
  players,
  currentPlayer,
  statsByPlayerId,
  checkoutSuggestion,
  canSubmit,
  onSubmit,
  autodartsControllingTurn,
  autodartsTurnReady,
  autodartsBaselineDarts,
  perDartOnly,
  entryMode,
  setEntryMode,
  totalText,
  setTotalText,
  total,
  setTotal,
  darts,
  setDarts,
  onVoiceInput,
  voiceAlwaysOn,
  setVoiceAlwaysOn,
  voiceSupported,
  voiceListening,
  finished,
}: {
  code: string
  match: MatchSnapshot | undefined
  leg: MatchSnapshot['leg'] | undefined
  players: Player[]
  currentPlayer: Player | null
  statsByPlayerId: Record<string, PlayerStats>
  checkoutSuggestion: { labels: string[] } | null
  canSubmit: boolean
  onSubmit: (withDarts?: boolean) => Promise<void>
  autodartsControllingTurn: boolean
  autodartsTurnReady: boolean
  autodartsBaselineDarts: Dart[] | null
  perDartOnly: boolean
  entryMode: 'TOTAL' | 'PER_DART'
  setEntryMode: (m: 'TOTAL' | 'PER_DART') => void
  totalText: string
  setTotalText: (t: string) => void
  total: number
  setTotal: (n: number) => void
  darts: Dart[]
  setDarts: (d: Dart[]) => void
  onVoiceInput: () => void
  voiceAlwaysOn: boolean
  setVoiceAlwaysOn: (v: boolean | ((prev: boolean) => boolean)) => void
  voiceSupported: boolean
  voiceListening: boolean
  finished: boolean
}) {
  const p = currentPlayer
  const stats = p ? statsByPlayerId[p.id] : undefined
  const ps = p ? leg?.players?.find((x) => x.playerId === p.id) : undefined

  const last = p ? lastScoreForPlayer(leg?.turns ?? [], p.id) : null
  const thrown = p ? dartsThrownForPlayer(leg?.turns ?? [], p.id) : 0

  return (
    <div className="mobileGame">
      <div className="mobileGameTop">
        <button
          className="mobileIconBtn"
          onClick={() => {
            if (window.history.length > 1) window.history.back()
            else window.location.href = '/'
          }}
          aria-label="Back"
        >
          <svg className="mobileIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="mobileHeaderTitle">
          {match?.settings?.setsEnabled ? `FIRST TO ${match.settings.setsToWin} SETS` : `FIRST TO ${match?.settings?.legsToWin ?? 0} LEGS`}
        </div>
        <button
          className="mobileIconBtn"
          onClick={() => window.dispatchEvent(new Event('dc:openMenu'))}
          aria-label="Menu"
        >
          <svg className="mobileIcon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className={canSubmit && !finished ? `playerCard playerCardUp` : 'playerCard'}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="row">
            <span className="pill" style={{ color: 'var(--text)' }}>{p?.name ?? 'Waiting...'}</span>
            {match ? <span className="pill">Set {match.currentSetNumber} · Leg {match.currentLeg.legNumber}</span> : null}
          </div>
          {match ? (
            <span className="pill">
              {match.settings.startScore} · {match.settings.doubleIn ? 'DI' : 'SI'} · {match.settings.doubleOut ? 'DO' : match.settings.masterOut ? 'MO' : 'SO'}
            </span>
          ) : null}
        </div>

        <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          {match?.settings?.setsEnabled ? <span className="pill">Sets won: {stats?.setsWon ?? 0}</span> : null}
          <span className="pill">Legs won: {stats?.legsWon ?? 0}</span>
          {autodartsControllingTurn ? <span className="pill" style={{ color: 'var(--accent)' }}>Autodarts scoring</span> : null}
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
          <div className="playerBigNum">{ps?.remaining ?? '-'}</div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
            <span className="pill">3-dart avg: {stats?.threeDartAvg ?? '-'}</span>
            <span className="pill">Last score: {last ?? '-'}</span>
            <span className="pill">Darts thrown: {thrown}</span>
          </div>
        </div>

        {checkoutSuggestion ? (
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <span className="pill">Checkout</span>
            <span className="pill" style={{ color: 'var(--text)' }}>{checkoutSuggestion.labels.join('  ')}</span>
          </div>
        ) : null}
      </div>

      <div className="turnBanner">
        {finished
          ? 'FINISHED'
          : autodartsControllingTurn
            ? autodartsTurnReady
              ? 'REVIEW AND SUBMIT'
              : 'AUTODARTS SCORING'
            : canSubmit
              ? "IT'S YOUR TURN"
              : 'WAITING'}
      </div>

      <MobileTurnEntry
        entryMode={entryMode}
        setEntryMode={setEntryMode}
        autodartsBaselineDarts={autodartsBaselineDarts}
        perDartOnly={perDartOnly}
        totalText={totalText}
        setTotalText={setTotalText}
        total={total}
        setTotal={setTotal}
        darts={darts}
        setDarts={setDarts}
        onVoiceInput={onVoiceInput}
        voiceAlwaysOn={voiceAlwaysOn}
        setVoiceAlwaysOn={setVoiceAlwaysOn}
        voiceSupported={voiceSupported}
        voiceListening={voiceListening}
        canSubmit={canSubmit && !finished}
        onSubmit={() => onSubmit(false)}
      />
    </div>
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

function MobileTurnEntry({
  entryMode,
  setEntryMode,
  autodartsBaselineDarts,
  perDartOnly,
  totalText,
  setTotalText,
  total,
  setTotal,
  darts,
  setDarts,
  onVoiceInput,
  voiceAlwaysOn,
  setVoiceAlwaysOn,
  voiceSupported,
  voiceListening,
  canSubmit,
  onSubmit,
}: {
  entryMode: 'TOTAL' | 'PER_DART'
  setEntryMode: (m: 'TOTAL' | 'PER_DART') => void
  autodartsBaselineDarts: Dart[] | null
  perDartOnly: boolean
  totalText: string
  setTotalText: (t: string) => void
  total: number
  setTotal: (n: number) => void
  darts: Dart[]
  setDarts: (d: Dart[]) => void
  onVoiceInput: () => void
  voiceAlwaysOn: boolean
  setVoiceAlwaysOn: (v: boolean | ((prev: boolean) => boolean)) => void
  voiceSupported: boolean
  voiceListening: boolean
  canSubmit: boolean
  onSubmit: () => void
}) {
  const [dartMode, setDartMode] = useState<'S' | 'D' | 'T' | 'DB' | 'SB'>('S')
  const [dartCursor, setDartCursor] = useState(0)

  const labels = darts.map((d) => dartToLabel(d))
  const totalFromDarts = darts.reduce((acc, d) => acc + dartPoints(d), 0)

  useEffect(() => {
    if (entryMode !== 'PER_DART') return
    if (!autodartsBaselineDarts || autodartsBaselineDarts.length < 1) return

    const baseline = toEditorDarts(autodartsBaselineDarts)
    const idx = firstDifferentDartIndex(darts, baseline)
    if (idx >= 0 && idx <= 2 && idx !== dartCursor) {
      setDartCursor(idx)
    }
  }, [entryMode, autodartsBaselineDarts, darts, dartCursor])

  function resetDarts() {
    setDarts([
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
    ])
    setDartCursor(0)
  }

  function setDigit(d: string) {
    const raw = (totalText + d).replace(/^0+(?=\d)/, '')

    function pickValid(s: string): string {
      const cleaned = s.replace(/^0+(?=\d)/, '')
      const n = cleaned === '' ? 0 : Number(cleaned)
      if (!Number.isFinite(n)) return ''
      if (n < 0 || n > 180) return ''
      return cleaned
    }

    // Prefer the longest valid suffix (3 -> 2 -> 1 digits), so:
    // 616 -> 16, 189 -> 89, 66120 -> 120
    const candidates: string[] = []
    const digits = raw.replace(/[^0-9]/g, '')
    if (digits.length <= 3) candidates.push(digits)
    else candidates.push(digits.slice(-3))
    candidates.push(digits.slice(-2))
    candidates.push(digits.slice(-1))

    let next = ''
    for (const c of candidates) {
      const v = pickValid(c)
      if (v !== '') {
        next = v
        break
      }
    }

    setTotalText(next)
    setTotal(next === '' ? 0 : Number(next))
  }

  function backspace() {
    const next = totalText.slice(0, -1)
    setTotalText(next)
    const n = next === '' ? 0 : Number(next)
    if (Number.isFinite(n)) setTotal(Math.min(180, n))
  }

  function clear() {
    setTotalText('')
    setTotal(0)
  }

  function miss() {
    if (entryMode !== 'PER_DART') return
    const idx = Math.min(2, dartCursor)
    const out = darts.map((d, i) => (i === idx ? ({ segment: 0, multiplier: 0 } as Dart) : d))
    setDarts(out)
    setDartCursor(Math.min(3, dartCursor + 1))
  }

  function undoDart() {
    if (entryMode !== 'PER_DART') return
    const nextCursor = Math.max(0, dartCursor - 1)
    const idx = Math.min(2, nextCursor)
    const out = darts.map((d, i) => (i === idx ? ({ segment: 0, multiplier: 0 } as Dart) : d))
    setDarts(out)
    setDartCursor(nextCursor)
  }

  function applySegment(seg: number) {
    if (entryMode !== 'PER_DART') return
    const idx = Math.min(2, dartCursor)
    let d: Dart
    if (dartMode === 'DB') d = { segment: 25, multiplier: 2 }
    else if (dartMode === 'SB') d = { segment: 25, multiplier: 1 }
    else if (dartMode === 'T') d = { segment: seg, multiplier: 3 }
    else if (dartMode === 'D') d = { segment: seg, multiplier: 2 }
    else d = { segment: seg, multiplier: 1 }

    const out = darts.map((x, i) => (i === idx ? d : x))
    setDarts(out)
    setDartCursor(Math.min(3, dartCursor + 1))
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="entryBar">
        <button
          className="entryToggle"
          onClick={() => {
            if (perDartOnly) {
              setEntryMode('PER_DART')
              return
            }
            const next = entryMode === 'TOTAL' ? 'PER_DART' : 'TOTAL'
            setEntryMode(next)
            if (next === 'TOTAL') clear()
            else resetDarts()
          }}
          aria-label="Toggle input"
          disabled={perDartOnly}
          title={perDartOnly ? 'Autodarts connected: per-dart only' : undefined}
        >
          {perDartOnly ? 'D' : entryMode === 'TOTAL' ? '123' : 'D'}
        </button>
        <button
          className="entryMic"
          onClick={onVoiceInput}
          aria-label={voiceListening ? 'Stop voice input' : 'Start voice input'}
          disabled={!voiceSupported}
          title={voiceSupported ? undefined : 'Voice input not supported in this browser'}
        >
          {voiceListening ? 'Stop' : 'Mic'}
        </button>
        <button
          className={voiceAlwaysOn ? 'entryMic entryMicActive' : 'entryMic'}
          onClick={() => setVoiceAlwaysOn((v) => !v)}
          aria-label={voiceAlwaysOn ? 'Disable always-on voice input' : 'Enable always-on voice input'}
          disabled={!voiceSupported}
          title={voiceSupported ? undefined : 'Voice input not supported in this browser'}
        >
          {voiceAlwaysOn ? 'Auto on' : 'Auto'}
        </button>
        <div className="entryDisplay">
          <span className="entryHint">{entryMode === 'TOTAL' ? 'Enter a score' : labels.join('  ')}</span>
          <span className="entryScore">{entryMode === 'TOTAL' ? total : totalFromDarts}</span>
        </div>
        <button className="entrySubmit" onClick={onSubmit} disabled={!canSubmit}>
          Submit
        </button>
      </div>

      {entryMode === 'TOTAL' && !perDartOnly ? (
        <div className="col" style={{ gap: 10 }}>
          <div className="padGrid">
            {['1','2','3','4','5','6','7','8','9'].map((n) => (
              <button key={n} className="padKey" onClick={() => setDigit(n)}>
                {n}
              </button>
            ))}
            <button className="padKey padKeyAlt" onClick={clear}>Clear</button>
            <button className="padKey" onClick={() => setDigit('0')}>0</button>
            <button className="padKey padKeyDanger" onClick={backspace}>Undo</button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="multTabs">
            {([
              ['S', 'Single'],
              ['D', 'Double'],
              ['T', 'Treble'],
              ['DB', 'Bull 50'],
              ['SB', 'Outer 25'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                className={dartMode === k ? 'multTab multTabActive' : 'multTab'}
                onClick={() => setDartMode(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="segGrid">
            {Array.from({ length: 20 }, (_, idx) => idx + 1).map((n) => (
              <button key={n} className="padKey" onClick={() => applySegment(n)}>
                {n}
              </button>
            ))}
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={undoDart}>Undo dart</button>
            <button className="btn" onClick={miss}>Miss</button>
          </div>
        </div>
      )}
    </div>
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

function firstDifferentDartIndex(a: Dart[], b: Dart[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i]
    const y = b[i]
    if (!x || !y) return i
    if (x.segment !== y.segment || x.multiplier !== y.multiplier) return i
  }
  return -1
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

  const direct = Number(txt)
  if (Number.isInteger(direct) && direct >= 1 && direct <= 180) return direct

  const numberInText = txt.match(/\b(\d{1,3})\b/)
  if (numberInText) {
    const n = Number(numberInText[1])
    if (Number.isInteger(n) && n >= 1 && n <= 180) return n
  }

  const english = parseEnglishNumber(txt)
  if (english != null && english >= 1 && english <= 180) return english

  return null
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

  speakCallout(text, lang)
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
  if (text) speakCallout(text, lang)
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

function speakCallout(text: string, lang: VoiceLang): void {
  if (typeof window === 'undefined') return
  const synth = (window as any).speechSynthesis
  const Ctor = (window as any).SpeechSynthesisUtterance
  if (!synth || !Ctor) return
  const utter = new Ctor(text)
  utter.lang = lang === 'NL' ? 'nl-NL' : lang === 'DE' ? 'de-DE' : 'en-US'
  utter.rate = 1
  utter.pitch = 1
  utter.volume = 1
  synth.speak(utter)
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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const m = window.matchMedia(query)
    const onChange = () => setMatches(Boolean(m.matches))
    onChange()
    if (typeof m.addEventListener === 'function') m.addEventListener('change', onChange)
    else m.addListener(onChange)
    return () => {
      if (typeof m.removeEventListener === 'function') m.removeEventListener('change', onChange)
      else m.removeListener(onChange)
    }
  }, [query])

  return matches
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

function EnterTurnCard({
  currentPlayer,
  checkoutSuggestion,
  entryMode,
  setEntryMode,
  darts,
  setDarts,
  totalText,
  setTotalText,
  total,
  setTotal,
  needDarts,
  setNeedDarts,
  submitTurn,
  settings,
  finished,
  canSubmit,
  autodartsControllingTurn,
  autodartsTurnReady,
  perDartOnly,
}: {
  currentPlayer: Player | null
  checkoutSuggestion: { labels: string[] } | null
  entryMode: 'TOTAL' | 'PER_DART'
  setEntryMode: (m: 'TOTAL' | 'PER_DART') => void
  darts: Dart[]
  setDarts: (d: Dart[]) => void
  totalText: string
  setTotalText: (t: string) => void
  total: number
  setTotal: (n: number) => void
  needDarts: null | 'DOUBLE_IN'
  setNeedDarts: (v: null | 'DOUBLE_IN') => void
  submitTurn: (withDarts?: boolean) => Promise<void>
  settings: MatchSnapshot['settings'] | undefined
  finished: boolean
  canSubmit: boolean
  autodartsControllingTurn: boolean
  autodartsTurnReady: boolean
  perDartOnly: boolean
}) {
  const effectiveEntryMode: 'TOTAL' | 'PER_DART' = perDartOnly ? 'PER_DART' : entryMode

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 16, marginBottom: 6 }}>Enter turn</div>
      <div className="help">
        {currentPlayer ? (
          <>Up: <b>{currentPlayer.name}</b></>
        ) : (
          <>Waiting for game to start...</>
        )}
      </div>

      {checkoutSuggestion ? (
        <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
          <span className="pill">Checkout</span>
          <span className="pill" style={{ color: 'var(--text)' }}>{checkoutSuggestion.labels.join('  ')}</span>
        </div>
      ) : null}

      <div className="col" style={{ marginTop: 10 }}>
        <div className="row">
          <button className="btn" onClick={() => setEntryMode('TOTAL')} disabled={perDartOnly || effectiveEntryMode === 'TOTAL'}>
            Total
          </button>
          <button className="btn" onClick={() => setEntryMode('PER_DART')} disabled={effectiveEntryMode === 'PER_DART'}>
            3 darts
          </button>
          {perDartOnly ? <span className="pill">Autodarts connected: per-dart only</span> : null}
        </div>

        {effectiveEntryMode === 'PER_DART' ? (
          <PerDartEditor darts={darts} onChange={setDarts} />
        ) : (
          <div className="col">
            <label className="help">Total (0-180)</label>
            <input
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={totalText}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                setTotalText(v)
                const n = v === '' ? 0 : Number(v)
                if (Number.isFinite(n)) setTotal(Math.min(180, n))
              }}
            />

            <div className="mobileOnly">
              <NumberPad
                valueText={totalText}
                onChangeText={(v) => {
                  const next = v.replace(/[^0-9]/g, '').slice(0, 3)
                  setTotalText(next)
                  const n = next === '' ? 0 : Number(next)
                  if (Number.isFinite(n)) setTotal(Math.min(180, n))
                }}
                onEnter={() => submitTurn(false)}
              />
            </div>
            {needDarts ? (
              <div className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.18)' }}>
                <div className="help" style={{ marginBottom: 8 }}>
                  Double-in is enabled and you are not in yet; enter darts so the server can verify the double-in.
                </div>
                <PerDartEditor darts={darts} onChange={setDarts} />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={() => setNeedDarts(null)}>
                    Cancel
                  </button>
                  <button className="btn btnPrimary" onClick={() => submitTurn(true)}>
                    Submit with darts
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <button className="btn btnPrimary" onClick={() => submitTurn(false)} disabled={!settings || !currentPlayer || finished || !canSubmit}>
          Submit turn
        </button>
        {!finished && autodartsControllingTurn && !autodartsTurnReady ? <div className="help">Autodarts is entering this turn.</div> : null}
        {!finished && autodartsTurnReady ? <div className="help">Review the autodarts darts and submit when ready.</div> : null}
        {!finished && currentPlayer && !canSubmit && !autodartsControllingTurn ? (
          <div className="help">Waiting for {currentPlayer.name} to submit.</div>
        ) : null}
      </div>
    </div>
  )
}

function PlayerPanel({
  player,
  isCurrent,
  leg,
  settings,
  match,
  stats,
  autodartsControllingTurn,
}: {
  player: Player
  isCurrent: boolean
  leg: MatchSnapshot['leg'] | undefined
  settings: MatchSnapshot['settings'] | undefined
  match: MatchSnapshot | undefined
  stats: PlayerStats | undefined
  autodartsControllingTurn: boolean
}) {
  const ps = leg?.players?.find((x) => x.playerId === player.id)
  const last = lastScoreForPlayer(leg?.turns ?? [], player.id)
  const thrown = dartsThrownForPlayer(leg?.turns ?? [], player.id)

  return (
    <div className={isCurrent ? 'playerCard playerCardUp' : 'playerCard'}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="pill" style={{ color: 'var(--text)' }}>{player.name}</span>
          {isCurrent ? <span className="pill" style={{ color: 'rgba(0,0,0,0.82)', background: 'rgba(255,255,255,0.55)' }}>UP</span> : null}
          {settings?.doubleIn ? (
            <span className="pill" style={{ color: ps?.isIn ? 'var(--good)' : 'var(--muted)' }}>
              {ps?.isIn ? 'IN' : 'NOT IN'}
            </span>
          ) : null}
          {autodartsControllingTurn ? <span className="pill" style={{ color: 'var(--accent)' }}>Autodarts scoring</span> : null}
        </div>
        {match?.settings?.setsEnabled ? <span className="pill">Sets: {stats?.setsWon ?? 0}</span> : null}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
        <div className="playerBigNum playerBigNumDesktop">{ps?.remaining ?? '-'}</div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
          <span className="pill">Legs: {stats?.legsWon ?? 0}</span>
          <span className="pill">3-dart avg: {stats?.threeDartAvg ?? '-'}</span>
          <span className="pill">Last score: {last ?? '-'}</span>
          <span className="pill">Darts thrown: {thrown}</span>
        </div>
      </div>
    </div>
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

type DartKind = 'MISS' | 'S' | 'D' | 'T' | 'SB' | 'DB'

function kindFromDart(d: Dart): DartKind {
  if (d.multiplier === 0) return 'MISS'
  if (d.segment === 25 && d.multiplier === 1) return 'SB'
  if (d.segment === 25 && d.multiplier === 2) return 'DB'
  if (d.multiplier === 3) return 'T'
  if (d.multiplier === 2) return 'D'
  return 'S'
}

function dartFrom(kind: DartKind, segment: number): Dart {
  if (kind === 'MISS') return { segment: 0, multiplier: 0 }
  if (kind === 'SB') return { segment: 25, multiplier: 1 }
  if (kind === 'DB') return { segment: 25, multiplier: 2 }
  const seg = Math.max(1, Math.min(20, Math.floor(segment)))
  if (kind === 'T') return { segment: seg, multiplier: 3 }
  if (kind === 'D') return { segment: seg, multiplier: 2 }
  return { segment: seg, multiplier: 1 }
}

function PerDartEditor({ darts, onChange }: { darts: Dart[]; onChange: (d: Dart[]) => void }) {
  const isMobile = useMediaQuery('(max-width: 520px)')

  if (isMobile) {
    return <MobilePerDartEditor darts={darts} onChange={onChange} />
  }

  return <PcPerDartEditor darts={darts} onChange={onChange} />
}

function PcPerDartEditor({ darts, onChange }: { darts: Dart[]; onChange: (d: Dart[]) => void }) {
  const [segText, setSegText] = useState<string[]>(() =>
    [0, 1, 2].map((i) => String((darts[i]?.segment ?? 20) === 25 ? 20 : darts[i]?.segment ?? 20)),
  )

  useEffect(() => {
    setSegText([0, 1, 2].map((i) => String((darts[i]?.segment ?? 20) === 25 ? 20 : darts[i]?.segment ?? 20)))
  }, [darts])

  function setDart(i: number, next: Dart) {
    const out = darts.map((d, idx) => (idx === i ? next : d))
    onChange(out)
  }

  function setKind(i: number, kind: DartKind) {
    const currentSeg = Number(segText[i] ?? '20')
    const seg = Number.isFinite(currentSeg) ? currentSeg : 20
    setDart(i, dartFrom(kind, seg))
  }

  function setSegment(i: number, raw: string) {
    const v = raw.replace(/[^0-9]/g, '').slice(0, 2)
    setSegText((s) => s.map((x, idx) => (idx === i ? v : x)))
    const n = v === '' ? NaN : Number(v)
    if (!Number.isFinite(n)) return
    const k = kindFromDart(darts[i] ?? { segment: 20, multiplier: 1 })
    if (k === 'MISS' || k === 'SB' || k === 'DB') return
    setDart(i, dartFrom(k, n))
  }

  return (
    <div className="col">
      <div className="help">Enter each dart as Single/Double/Triple + segment 1-20, or SB (25) / DB (50) / Miss.</div>

      <div className="grid2">
        {[0, 1, 2].map((i) => {
          const d = darts[i] ?? { segment: 20, multiplier: 1 }
          const kind = kindFromDart(d)
          const needsSeg = kind === 'S' || kind === 'D' || kind === 'T'
          return (
            <div key={i} className="card" style={{ padding: 12, background: 'rgba(0,0,0,0.14)' }}>
              <div className="help" style={{ marginBottom: 8 }}>Dart {i + 1}</div>
              <div className="col">
                <select className="select" value={kind} onChange={(e) => setKind(i, e.target.value as DartKind)}>
                  <option value="MISS">Miss</option>
                  <option value="S">Single</option>
                  <option value="D">Double</option>
                  <option value="T">Triple</option>
                  <option value="SB">Single bull (25)</option>
                  <option value="DB">Bullseye (50)</option>
                </select>

                <input
                  className="input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="1-20"
                  disabled={!needsSeg}
                  value={needsSeg ? segText[i] ?? '' : ''}
                  onChange={(e) => setSegment(i, e.target.value)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MobilePerDartEditor({ darts, onChange }: { darts: Dart[]; onChange: (d: Dart[]) => void }) {
  const [active, setActive] = useState<0 | 1 | 2>(0)
  const [panel, setPanel] = useState<'KIND' | 'SEG'>('KIND')
  const current = darts[active] ?? { segment: 20, multiplier: 1 }
  const kind = kindFromDart(current)
  const needsSeg = kind === 'S' || kind === 'D' || kind === 'T'

  function setDart(i: 0 | 1 | 2, next: Dart) {
    const out = darts.map((d, idx) => (idx === i ? next : d))
    onChange(out)
  }

  function setKind(nextKind: DartKind) {
    const seg = current.segment === 25 ? 20 : current.segment || 20
    setDart(active, dartFrom(nextKind, seg))
    if (nextKind === 'S' || nextKind === 'D' || nextKind === 'T') setPanel('SEG')
    else setPanel('KIND')
  }

  function setSegment(seg: number) {
    setDart(active, dartFrom(kind === 'S' || kind === 'D' || kind === 'T' ? kind : 'S', seg))
  }

  return (
    <div className="col">
      <div className="help">Tap each dart (no typing).</div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="pill">Dart {active + 1} · {kind}{needsSeg ? ` ${current.segment}` : ''}</span>
        <div className="row">
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              className={active === i ? 'btn btnPrimary' : 'btn'}
              onClick={() => setActive(i as 0 | 1 | 2)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <button className={panel === 'KIND' ? 'btn btnPrimary' : 'btn'} onClick={() => setPanel('KIND')}>
          Type
        </button>
        <button className={panel === 'SEG' ? 'btn btnPrimary' : 'btn'} onClick={() => setPanel('SEG')} disabled={!needsSeg}>
          Segment
        </button>
        <span className="pill">{needsSeg ? '1-20' : kind === 'SB' ? '25' : kind === 'DB' ? '50' : ''}</span>
      </div>

      {panel === 'KIND' ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className={kind === 'MISS' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('MISS')}>
            Miss
          </button>
          <button className={kind === 'S' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('S')}>
            Single
          </button>
          <button className={kind === 'D' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('D')}>
            Double
          </button>
          <button className={kind === 'T' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('T')}>
            Triple
          </button>
          <button className={kind === 'SB' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('SB')}>
            SB
          </button>
          <button className={kind === 'DB' ? 'btn btnPrimary' : 'btn'} onClick={() => setKind('DB')}>
            DB
          </button>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="segGrid">
            {Array.from({ length: 20 }, (_, idx) => idx + 1).map((n) => (
              <button
                key={n}
                className={n === current.segment ? 'key keyPrimary' : 'key'}
                onClick={() => setSegment(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn" onClick={() => setActive((a) => (a === 0 ? 0 : ((a - 1) as 0 | 1 | 2)))}>
          Back
        </button>
        <button className="btn btnPrimary" onClick={() => setActive((a) => (a === 2 ? 2 : ((a + 1) as 0 | 1 | 2)))}>
          Next
        </button>
      </div>
    </div>
  )
}

function NumberPad({
  valueText,
  onChangeText,
  onEnter,
  enterLabel,
}: {
  valueText: string
  onChangeText: (v: string) => void
  onEnter: () => void
  enterLabel?: string
}) {
  const enter = enterLabel ?? 'Enter'

  function append(d: string) {
    const next = (valueText + d).replace(/^0+(?=\d)/, '')
    onChangeText(next)
  }

  function backspace() {
    onChangeText(valueText.slice(0, -1))
  }

  function clear() {
    onChangeText('')
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="keypad">
        <button className="key" onClick={() => append('1')}>
          1
        </button>
        <button className="key" onClick={() => append('2')}>
          2
        </button>
        <button className="key" onClick={() => append('3')}>
          3
        </button>
        <button className="key" onClick={() => append('4')}>
          4
        </button>
        <button className="key" onClick={() => append('5')}>
          5
        </button>
        <button className="key" onClick={() => append('6')}>
          6
        </button>
        <button className="key" onClick={() => append('7')}>
          7
        </button>
        <button className="key" onClick={() => append('8')}>
          8
        </button>
        <button className="key" onClick={() => append('9')}>
          9
        </button>
        <button className="key keyDanger" onClick={clear}>
          Clear
        </button>
        <button className="key" onClick={() => append('0')}>
          0
        </button>
        <button className="key" onClick={backspace}>
          Bksp
        </button>
        <button className="key keyPrimary keyWide" onClick={onEnter}>
          {enter}
        </button>
      </div>
    </div>
  )
}
