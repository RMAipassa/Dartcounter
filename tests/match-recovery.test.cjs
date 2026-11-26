const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { once } = require('node:events')
const { mkdtemp, rm } = require('node:fs/promises')
const { createRequire } = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const { io } = createRequire(path.join(root, 'web', 'package.json'))('socket.io-client')

async function startServer(cwd) {
  const child = spawn(process.execPath, [path.join(root, 'dist', 'server.js')], {
    cwd,
    env: { ...process.env, PORT: '0', ENABLE_NEXT: 'false', AUTODARTS_ENABLED: 'false', SMTP_HOST: '' },
  })
  let stdout = ''
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 10_000)
      child.once('error', (err) => { clearTimeout(timer); reject(err) })
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${stderr}`)) })
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        const port = stdout.match(/server listening on :(\d+)/)?.[1]
        if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`) }
      })
    })
    return { child, url }
  } catch (err) {
    await stopServer({ child })
    throw err
  }
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return
  const done = once(server.child, 'exit')
  server.child.kill('SIGKILL')
  await done
}

async function client(url, sockets) {
  const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 3000 })
  sockets.add(socket)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  return socket
}

async function emit(socket, event, payload) {
  const response = await socket.timeout(3000).emitWithAck(event, payload)
  assert.equal(response?.ok, true, `${event}: ${response?.message}`)
  return response
}

async function eventWithSnapshot(socket, event, payload) {
  const [[snapshot], response] = await Promise.all([once(socket, 'room:snapshot', { signal: AbortSignal.timeout(3000) }), emit(socket, event, payload)])
  return { response, snapshot }
}

const x01 = { gameType: 'X01', startScore: 301, legsToWin: 2, setsEnabled: false, setsToWin: 0, doubleOut: true, doubleIn: false, masterOut: false }
const around = { gameType: 'AROUND', legsToWin: 2, setsEnabled: false, setsToWin: 0, advanceByMultiplier: false }
const practice = { gameType: 'PRACTICE', practiceMode: 'X01', startScore: 301, legsToWin: 1, setsEnabled: false, setsToWin: 0 }

test('restores matches and controllers after refresh and a forced server restart', { timeout: 40_000 }, async () => {
  const cwd = await mkdtemp(path.join(process.env.DARTCOUNTER_TEST_TMPDIR || os.tmpdir(), 'dartcounter-recovery-'))
  const sockets = new Set()
  let server
  try {
    server = await startServer(cwd)
    const host = await client(server.url, sockets)
    const guest = await client(server.url, sockets)
    const created = await emit(host, 'room:create', { name: 'Host', settings: x01, isPublic: true })
    const { code, hostSecret } = created
    const { player: local } = await emit(host, 'lobby:addPlayer', { hostSecret, name: 'Local' })
    const remote = await emit(guest, 'room:join', { code, name: 'Remote' })
    await emit(host, 'lobby:startGame', { hostSecret, startingPlayerIndex: 0 })
    await emit(host, 'game:submitTurn', { total: 60 })

    // A refresh with another player still online must not hand the host role away.
    host.close()
    const reloadedHost = await client(server.url, sockets)
    const refreshed = await eventWithSnapshot(reloadedHost, 'room:join', { code, name: 'Host', hostSecret })
    assert.ok(refreshed.response.controlledPlayerIds.includes(local.id))
    assert.equal(refreshed.snapshot.match.leg.players[0].remaining, 241)
    assert.ok(refreshed.snapshot.clients.find((entry) => entry.socketId === reloadedHost.id)?.isHost)

    const second = await client(server.url, sockets)
    const aroundRoom = await emit(second, 'room:create', { name: 'Around', settings: around })
    await emit(second, 'lobby:startGame', { hostSecret: aroundRoom.hostSecret, startingPlayerIndex: 0 })
    await emit(second, 'game:submitTurn', { darts: [{ segment: 1, multiplier: 1 }] })
    const setHost = await client(server.url, sockets)
    const setRoom = await emit(setHost, 'room:create', {
      name: 'Set player', settings: { ...x01, startScore: 121, legsToWin: 1, setsEnabled: true, setsToWin: 2 },
    })
    await emit(setHost, 'lobby:startGame', { hostSecret: setRoom.hostSecret, startingPlayerIndex: 0 })
    await emit(setHost, 'game:submitTurn', { darts: [{ segment: 20, multiplier: 3 }, { segment: 7, multiplier: 3 }, { segment: 20, multiplier: 2 }] })
    const training = await client(server.url, sockets)
    const practiceRoom = await emit(training, 'room:create', { name: 'Practice', settings: practice })

    // Kill immediately after the successful acknowledgements, like the Windows updater.
    await stopServer(server)
    for (const socket of sockets) socket.close()
    server = await startServer(cwd)
    const resumedHost = await client(server.url, sockets)
    const resumed = await eventWithSnapshot(resumedHost, 'room:join', { code, name: 'Host', hostSecret })
    assert.equal(resumed.snapshot.match.status, 'LIVE')
    assert.equal(resumed.snapshot.match.settings.startScore, 301)
    assert.equal(resumed.snapshot.match.leg.players[0].remaining, 241)
    assert.equal(resumed.snapshot.match.players[resumed.snapshot.match.leg.currentPlayerIndex].id, local.id)
    assert.deepEqual(new Set(resumed.response.controlledPlayerIds), new Set([created.playerId, local.id]))
    await emit(resumedHost, 'game:submitTurn', { total: 85 })
    const remoteBlocked = await resumedHost.timeout(3000).emitWithAck('game:submitTurn', { total: 41 })
    assert.equal(remoteBlocked.code, 'NOT_YOUR_TURN')
    const resumedGuest = await client(server.url, sockets)
    const joinedGuest = await eventWithSnapshot(resumedGuest, 'room:join', { code, name: 'Remote' })
    assert.equal(joinedGuest.response.playerId, remote.playerId)
    const { snapshot } = await eventWithSnapshot(resumedGuest, 'game:submitTurn', { total: 41 })
    assert.deepEqual(snapshot.match.leg.turns.map((turn) => turn.scoreTotal), [60, 85, 41])
    assert.deepEqual(snapshot.match.leg.players.map((player) => player.remaining), [241, 216, 260])

    const resumedAround = await client(server.url, sockets)
    const restoredAround = await eventWithSnapshot(resumedAround, 'room:join', { code: aroundRoom.code, name: 'Around', hostSecret: aroundRoom.hostSecret })
    assert.equal(restoredAround.snapshot.match.leg.players[0].remaining, 2)
    const missing = await resumedAround.timeout(3000).emitWithAck('room:join', { code: practiceRoom.code, name: 'Practice', hostSecret: practiceRoom.hostSecret })
    assert.equal(missing.code, 'ROOM_NOT_FOUND')
    const resumedSetHost = await client(server.url, sockets)
    const restoredSet = await eventWithSnapshot(resumedSetHost, 'room:join', { code: setRoom.code, name: 'Set player', hostSecret: setRoom.hostSecret })
    assert.equal(restoredSet.snapshot.match.currentSetNumber, 2)
    assert.equal(restoredSet.snapshot.match.currentLegIndex, 1)
    assert.equal(restoredSet.snapshot.match.setsWonByPlayerId[setRoom.playerId], 1)
    assert.equal(restoredSet.snapshot.match.leg.players[0].remaining, 121)
  } finally {
    for (const socket of sockets) socket.close()
    await stopServer(server)
    await rm(cwd, { recursive: true, force: true })
  }
})

test('lists only authorized open matches and restores the owner on another device', { timeout: 40_000 }, async () => {
  const cwd = await mkdtemp(path.join(process.env.DARTCOUNTER_TEST_TMPDIR || os.tmpdir(), 'dartcounter-my-matches-'))
  const sockets = new Set()
  const ownerDevice = randomBytes(32).toString('hex')
  const guestDevice = randomBytes(32).toString('hex')
  let server
  try {
    server = await startServer(cwd)
    const registration = await fetch(`${server.url}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', password: 'fixture-only-2026', displayName: 'Owner' }),
    })
    assert.ok(registration.ok)
    const { token } = await registration.json()
    const owner = await client(server.url, sockets)
    const guest = await client(server.url, sockets)
    const outsider = await client(server.url, sockets)
    const match = await emit(owner, 'room:create', { name: 'Owner', authToken: token, deviceKey: ownerDevice, settings: x01, title: 'Private match' })
    const joinedGuest = await emit(guest, 'room:join', { code: match.code, name: 'Guest', deviceKey: guestDevice })
    await emit(owner, 'lobby:startGame', { hostSecret: match.hostSecret, startingPlayerIndex: 0 })
    await emit(owner, 'game:submitTurn', { total: 60 })
    const lobby = await emit(owner, 'room:create', { name: 'Owner', authToken: token, deviceKey: ownerDevice, settings: around })
    await emit(owner, 'room:create', { name: 'Owner', authToken: token, deviceKey: ownerDevice, settings: practice })
    const finished = await emit(owner, 'room:create', { name: 'Owner', authToken: token, settings: { ...x01, startScore: 121, legsToWin: 1 } })
    await emit(owner, 'lobby:startGame', { hostSecret: finished.hostSecret, startingPlayerIndex: 0 })
    await emit(owner, 'game:submitTurn', { darts: [{ segment: 20, multiplier: 3 }, { segment: 7, multiplier: 3 }, { segment: 20, multiplier: 2 }] })

    assert.deepEqual((await emit(outsider, 'rooms:listMine', { hostProofs: [{ code: match.code, hostSecret: 'wrong' }] })).matches, [])
    const viaProof = await emit(outsider, 'rooms:listMine', { hostProofs: [{ code: match.code, hostSecret: match.hostSecret }] })
    assert.deepEqual(viaProof.matches.map((room) => [room.code, room.role]), [[match.code, 'HOST']])
    assert.ok(!Object.hasOwn(viaProof.matches[0], 'hostSecret'))
    const forged = await emit(outsider, 'room:join', { code: match.code, name: 'Guest', deviceKey: ownerDevice })
    assert.equal(forged.role, 'SPECTATOR')

    await stopServer(server)
    for (const socket of sockets) socket.close()
    server = await startServer(cwd)
    const newDevice = await client(server.url, sockets)
    const ownRooms = await emit(newDevice, 'rooms:listMine', { authToken: token })
    assert.deepEqual(new Set(ownRooms.matches.map((room) => `${room.code}:${room.status}:${room.role}`)),
      new Set([`${match.code}:LIVE:HOST`, `${lobby.code}:LOBBY:HOST`]))
    const joined = await eventWithSnapshot(newDevice, 'room:join', { code: match.code, name: 'Owner', authToken: token })
    assert.equal(joined.response.hostSecret, match.hostSecret)
    assert.equal(joined.snapshot.match.leg.players[0].remaining, 241)
    assert.ok(joined.snapshot.clients.find((entry) => entry.socketId === newDevice.id)?.isHost)

    const guestBrowser = await client(server.url, sockets)
    const theirRooms = await emit(guestBrowser, 'rooms:listMine', { deviceKey: guestDevice })
    assert.deepEqual(theirRooms.matches.map((room) => [room.code, room.role]), [[match.code, 'PLAYER']])
    const resumed = await eventWithSnapshot(guestBrowser, 'room:join', { code: match.code, name: 'Different display name', deviceKey: guestDevice })
    assert.equal(resumed.response.playerId, joinedGuest.playerId)
    assert.equal(resumed.response.hostSecret, undefined)
    const scored = await eventWithSnapshot(guestBrowser, 'game:submitTurn', { total: 45 })
    assert.deepEqual(scored.snapshot.match.leg.turns.map((visit) => visit.scoreTotal), [60, 45])
  } finally {
    for (const socket of sockets) socket.close()
    await stopServer(server)
    await rm(cwd, { recursive: true, force: true })
  }
})
