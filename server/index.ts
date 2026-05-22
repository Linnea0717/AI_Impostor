// server/index.ts
import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomUUID } from 'crypto'
import {
  createRoom, addPlayer, removePlayer, setPlayerConfirmed,
  submitAnswer, voteForAnswer, prepareVoting, applyScoreDeltas,
  resetPerRound, allConfirmed, allSubmitted, allVoted, toPublicRoom,
} from './game/room'
import { calculateRoundScores } from './game/scoring'
import { listPools, loadPool, pickWord, type WordEntry } from './game/wordbank'
import { generateDefinition, guessDefinition } from './llm/provider'
import type { Room, Answer } from '~shared/types'

const app = express()
app.use(express.json())
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

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
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ])
}

function cleanupRoom(code: string) {
  rooms.delete(code)
  wordPools.delete(code)
  usedWords.delete(code)
  pendingAiDefinitions.delete(code)
  clearTimer(code)
}

// ── State transitions ────────────────────────────────────────────────
async function advanceToWordGeneration(code: string) {
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

  let definition: string
  try {
    definition = await withTimeout(generateDefinition(entry.word), 5_000)
  } catch {
    definition = entry.fallback
  }
  pendingAiDefinitions.set(code, definition)

  room = rooms.get(code)
  if (!room || room.state !== 'WORD_GENERATION') return  // guard against race

  room = { ...room, state: 'ANSWER_INPUT', currentWord: entry.word, timerEndsAt: Date.now() + 60_000 }
  rooms.set(code, room)
  broadcast(room)

  setTimer(code, 60_000, () => advanceToVoting(code))
}

async function advanceToVoting(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room || room.state !== 'ANSWER_INPUT') return

  const aiText = pendingAiDefinitions.get(code) ?? '（AI 備援定義）'
  pendingAiDefinitions.delete(code)
  const aiAnswer: Answer = { id: randomUUID(), text: aiText, authorId: 'AI', votes: [] }

  room = prepareVoting(room, aiAnswer)
  room = { ...room, timerEndsAt: Date.now() + 45_000 }
  rooms.set(code, room)
  broadcast(room)

  // AI guesser runs in parallel — result stored when ready, revealed in ROUND_RESULT
  const answersForGuesser = room.answers.map(a => ({ id: a.id, text: a.text }))
  withTimeout(guessDefinition(answersForGuesser), 45_000)
    .then(answerId => {
      const r = rooms.get(code)
      if (!r || r.state !== 'VOTING') return
      rooms.set(code, { ...r, aiGuesserVote: answerId })
    })
    .catch(() => {
      const r = rooms.get(code)
      if (!r || r.state !== 'VOTING') return
      rooms.set(code, { ...r, aiGuesserVote: 'TIMEOUT' })
    })

  setTimer(code, 45_000, () => advanceToRoundResult(code))
}

function advanceToRoundResult(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room || room.state !== 'VOTING') return

  const deltas = calculateRoundScores(room.answers, room.players)
  room = applyScoreDeltas(room, deltas)
  room = { ...room, state: 'ROUND_RESULT', timerEndsAt: Date.now() + 15_000 }
  rooms.set(code, room)
  broadcast(room)

  setTimer(code, 15_000, () => advanceFromRoundResult(code))
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
  } else if (room.state === 'ANSWER_INPUT' && allSubmitted(room)) {
    advanceToVoting(code)
  } else if (room.state === 'VOTING' && allVoted(room)) {
    advanceToRoundResult(code)
  }
}

// ── REST endpoints ──────────────────────────────────────────────────
app.get('/api/pools', (_req, res) => {
  res.json({ pools: listPools() })
})

app.post('/api/rooms', (req, res) => {
  const { questionPool } = req.body as { questionPool?: string }
  if (!questionPool || !listPools().includes(questionPool)) {
    res.status(400).json({ error: 'Invalid question pool' })
    return
  }
  let room = createRoom(questionPool)
  // Ensure unique code (max 5 attempts)
  let attempts = 0
  while (rooms.has(room.code) && attempts < 5) { room = createRoom(questionPool); attempts++ }
  rooms.set(room.code, room)
  wordPools.set(room.code, loadPool(questionPool))
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
      setTimer(code, 60_000, () => advanceToWordGeneration(code))
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

const PORT = process.env.PORT ?? 3001
httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
