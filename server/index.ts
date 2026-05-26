// server/index.ts
import { config as loadEnv } from 'dotenv'
// Load .env from the project root regardless of which directory the server is started from
loadEnv({ path: new URL('../.env', import.meta.url).pathname })
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
import {
  createRoom, addPlayer, removePlayer, setPlayerConfirmed,
  submitAnswer, voteForAnswer, prepareVoting, applyScoreDeltas,
  resetPerRound, allConfirmed, allSubmitted, allVoted, toPublicRoom,
} from './game/room'
import { calculateRoundScores } from './game/scoring'
import { listPools, loadPool, pickWord, type WordEntry } from './game/wordbank'
import { generateDefinition, guessDefinition } from './llm/provider'
import { parseSettings } from './settings'
import type { Room, Answer } from '~shared/types'

const app = express()
app.use(express.json())
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

// ── Phase durations (ms) ─────────────────────────────────────────────
const LOBBY_CONFIRM_MS = 60_000           // inactivity timeout after first player confirms in LOBBY
const ANSWER_INPUT_MS = 90_000            // time players have to write their fake definition
const VOTING_MS = 45_000                  // time players have to vote
const ROUND_RESULT_MS = 15_000            // result display between rounds
const AI_DEFINITION_TIMEOUT_MS = 58_000   // must be < ANSWER_INPUT_MS so fallback fires within phase
const AI_GUESSER_TIMEOUT_MS = 43_000      // must be < VOTING_MS so result is in before voting ends

// ── In-memory state ────────────────────────────────────────────────
const rooms = new Map<string, Room>()
const wordPools = new Map<string, WordEntry[]>()
const usedWords = new Map<string, Set<string>>()
const pendingAiDefinitions = new Map<string, string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

// ── Helpers ─────────────────────────────────────────────────────────
function broadcast(room: Room) {
  io.to(room.code).emit('room:state-update', toPublicRoom(room))
}

function setTimer(code: string, ms: number, cb: () => void) {
  const old = timers.get(code)
  if (old) clearTimeout(old)
  timers.set(code, setTimeout(cb, ms))
}

function clearTimer(code: string) {
  const t = timers.get(code)
  if (t) { clearTimeout(t); timers.delete(code) }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      val => { clearTimeout(timer); resolve(val) },
      err => { clearTimeout(timer); reject(err) }
    )
  })
}

function cleanupRoom(code: string) {
  rooms.delete(code)
  wordPools.delete(code)
  usedWords.delete(code)
  pendingAiDefinitions.delete(code)
  clearTimer(code)
}

// ── State transitions ────────────────────────────────────────────────
function advanceToWordGeneration(code: string) {
  let room = rooms.get(code)
  // Guard: only advance from LOBBY or ROUND_RESULT — prevents double-execution on race between timer + checkAndAdvance
  if (!room || !['LOBBY', 'ROUND_RESULT'].includes(room.state)) return

  room = resetPerRound(room)
  room = { ...room, state: 'WORD_GENERATION', round: room.round + 1 }
  rooms.set(code, room)
  broadcast(room)

  const pool = wordPools.get(code)!
  const used = usedWords.get(code)!
  const entry = pickWord(pool, used)
  used.add(entry.word)

  // Transition to ANSWER_INPUT immediately; LLM generates in parallel
  room = { ...room, state: 'ANSWER_INPUT', currentWord: entry.word, timerEndsAt: Date.now() + ANSWER_INPUT_MS, aiSubmitted: false }
  rooms.set(code, room)
  broadcast(room)

  setTimer(code, ANSWER_INPUT_MS, () => advanceToVoting(code))

  // AI generates in background — mark aiSubmitted when ready (or on fallback)
  withTimeout(generateDefinition(entry.word), AI_DEFINITION_TIMEOUT_MS)
    .then(definition => { pendingAiDefinitions.set(code, definition) })
    .catch(err => {
      console.error('[AI imposter] failed, using fallback:', err instanceof Error ? err.message : err)
      pendingAiDefinitions.set(code, entry.fallback)
    })
    .finally(() => {
      const r = rooms.get(code)
      if (!r || r.state !== 'ANSWER_INPUT') return
      rooms.set(code, { ...r, aiSubmitted: true })
      broadcast(rooms.get(code)!)
      checkAndAdvance(code)
    })
}

async function advanceToVoting(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room || room.state !== 'ANSWER_INPUT') return

  const aiText = pendingAiDefinitions.get(code) ?? '（AI 備援定義）'
  pendingAiDefinitions.delete(code)
  const aiAnswer: Answer = { id: randomUUID(), text: aiText, authorId: 'AI', votes: [] }

  room = prepareVoting(room, aiAnswer)
  room = { ...room, timerEndsAt: Date.now() + VOTING_MS }
  rooms.set(code, room)
  broadcast(room)

  // AI guesser runs in parallel — result stored when ready, revealed in ROUND_RESULT
  const answersForGuesser = room.answers.map(a => ({ id: a.id, text: a.text }))
  let aiGuesserVoteResult: string = 'TIMEOUT'
  withTimeout(guessDefinition(answersForGuesser), AI_GUESSER_TIMEOUT_MS)
    .then(answerId => { aiGuesserVoteResult = answerId })
    .catch(err => console.error('[AI guesser] failed:', err instanceof Error ? err.message : err))
    .finally(() => {
      const r = rooms.get(code)
      if (!r || (r.state !== 'VOTING' && r.state !== 'ROUND_RESULT')) return
      rooms.set(code, { ...r, aiGuesserVote: aiGuesserVoteResult, aiGuesserVoted: true })
      broadcast(rooms.get(code)!)
      // Only trigger early-stop if still voting; in ROUND_RESULT the score is already calculated
      if (r.state === 'VOTING') checkAndAdvance(code)
    })

  setTimer(code, VOTING_MS, () => advanceToRoundResult(code))
}

function advanceToRoundResult(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room || room.state !== 'VOTING') return

  const deltas = calculateRoundScores(room.answers, room.players)
  room = applyScoreDeltas(room, deltas)
  room = { ...room, state: 'ROUND_RESULT', timerEndsAt: Date.now() + ROUND_RESULT_MS }
  rooms.set(code, room)
  broadcast(room)

  setTimer(code, ROUND_RESULT_MS, () => advanceFromRoundResult(code))
}

function advanceFromRoundResult(code: string) {
  const room = rooms.get(code)
  if (!room || room.state !== 'ROUND_RESULT') return
  if (room.round >= room.maxRounds) {
    advanceToGameOver(code)
  } else {
    advanceToWordGeneration(code)
  }
}

function advanceToGameOver(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room) return
  room = { ...room, state: 'GAME_OVER' }
  rooms.set(code, room)
  broadcast(room)
}

function checkAndAdvance(code: string) {
  const room = rooms.get(code)
  if (!room) return
  if ((room.state === 'LOBBY' || room.state === 'ROUND_RESULT') && allConfirmed(room)) {
    clearTimer(code)
    if (room.state === 'LOBBY') advanceToWordGeneration(code)
    else advanceFromRoundResult(code)
  } else if (room.state === 'ANSWER_INPUT' && allSubmitted(room) && room.aiSubmitted) {
    advanceToVoting(code)
  } else if (room.state === 'VOTING' && allVoted(room) && room.aiGuesserVoted) {
    advanceToRoundResult(code)
  }
}

// ── REST endpoints ──────────────────────────────────────────────────
app.get('/api/pools', (_req, res) => {
  res.json({ pools: listPools() })
})

app.post('/api/rooms', (req, res) => {
  const body = req.body as {
    questionPool?: string
    answerInputSec?: number
    votingSec?: number
    endCondition?: { type: string; value: number }
  }

  const pools = listPools()
  const poolMeta = pools.find(p => p.id === body.questionPool)
  if (!poolMeta) {
    res.status(400).json({ error: 'invalid_question_pool' })
    return
  }

  const parsed = parseSettings(body)
  if (!parsed.ok) {
    res.status(400).json({
      error: 'settings_out_of_range',
      field: parsed.field,
      min: parsed.min,
      max: parsed.max,
    })
    return
  }

  let room = createRoom(poolMeta.id, poolMeta.name, parsed.value)
  let attempts = 0
  while (rooms.has(room.code) && attempts < 50) {
    room = createRoom(poolMeta.id, poolMeta.name, parsed.value)
    attempts++
  }
  if (rooms.has(room.code)) {
    res.status(500).json({ error: 'Failed to generate unique room code' })
    return
  }

  rooms.set(room.code, room)
  wordPools.set(room.code, loadPool(poolMeta.id))
  usedWords.set(room.code, new Set())
  res.json({ code: room.code })
})

// ── Socket.io ───────────────────────────────────────────────────────
io.on('connection', socket => {
  let playerCtx: { code: string; playerId: string } | null = null

  socket.on('player:join', ({ code, nickname, token }: { code: string; nickname: string; token?: string }) => {
    const room = rooms.get(code)
    if (!room) { socket.emit('room:error', { message: '找不到房間' }); return }
    if (room.state !== 'LOBBY' && !token) { socket.emit('room:error', { message: '遊戲已開始' }); return }

    const { room: updated, player } = addPlayer(room, nickname, token, socket.id)
    rooms.set(code, updated)
    playerCtx = { code, playerId: player.id }
    socket.join(code)
    socket.emit('player:token', { token: player.id })
    broadcast(updated)
  })

  socket.on('game:confirm', () => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room || !['LOBBY', 'ROUND_RESULT'].includes(room.state)) {
      socket.emit('room:error', { message: '目前無法確認' }); return
    }
    room = setPlayerConfirmed(room, playerId)
    rooms.set(code, room)
    broadcast(room)

    // LOBBY has no pre-existing timer — start the 60s inactivity timer on first confirm
    // ROUND_RESULT timer is already set inside advanceToRoundResult(), so we don't add another
    if (room.state === 'LOBBY' && !timers.has(code)) {
      setTimer(code, LOBBY_CONFIRM_MS, () => advanceToWordGeneration(code))
    }

    checkAndAdvance(code)  // if allConfirmed, clears timer and advances immediately
  })

  socket.on('game:submit-answer', ({ text }: { text: string }) => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room || room.state !== 'ANSWER_INPUT') {
      socket.emit('room:error', { message: '目前不是作答階段' }); return
    }
    room = submitAnswer(room, playerId, text)
    rooms.set(code, room)
    broadcast(room)
    checkAndAdvance(code)
  })

  socket.on('game:vote', ({ answerId }: { answerId: string }) => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room || room.state !== 'VOTING') {
      socket.emit('room:error', { message: '目前不是投票階段' }); return
    }
    room = voteForAnswer(room, playerId, answerId)
    rooms.set(code, room)
    broadcast(room)
    checkAndAdvance(code)
  })

  socket.on('disconnect', () => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room) return
    room = removePlayer(room, playerId)
    if (room.players.length === 0) { cleanupRoom(code); return }
    rooms.set(code, room)
    broadcast(room)
    checkAndAdvance(code)
  })
})

// Health check (Railway uses this to confirm the service is up)
app.get('/health', (_req, res) => res.json({ ok: true }))

// Serve built client
const clientDist = join(__dirname, '../client/dist')
const indexHtml = join(clientDist, 'index.html')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (_req, res, next) => {
    if (existsSync(indexHtml)) res.sendFile(indexHtml)
    else next()
  })
} else {
  console.warn('[server] client/dist not found — static serving disabled')
}

const PORT = process.env.PORT ?? 3001
httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
