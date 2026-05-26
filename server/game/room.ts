import { randomUUID } from 'crypto'
import type { Room, Player, Answer, GameSettings, PublicRoom } from '~shared/types'
import type { ScoreDeltas } from './scoring'

function generateCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

export function createRoom(
  questionPool: string,
  questionPoolName: string,
  settings: GameSettings,
): Room {
  return {
    code: generateCode(),
    hostId: '',
    questionPool,
    questionPoolName,
    players: [],
    state: 'LOBBY',
    round: 0,
    settings,
    currentWord: '',
    currentWordCorrect: '',
    answers: [],
    aiGuesserVote: null,
    aiGuesserVoted: false,
    aiSubmitted: false,
    scores: {},
    timerEndsAt: 0,
  }
}

export function addPlayer(
  room: Room,
  nickname: string,
  token: string | undefined,
  socketId: string
): { room: Room; player: Player } {
  // Reconnect path: token matches an existing player
  if (token) {
    const existing = room.players.find(p => p.id === token)
    if (existing) {
      const updated = { ...existing, socketId }
      const players = room.players.map(p => (p.id === token ? updated : p))
      return { room: { ...room, players }, player: updated }
    }
  }

  const player: Player = {
    id: randomUUID(),
    socketId,
    nickname,
    hasConfirmed: false,
    hasSubmitted: false,
    hasVoted: false,
  }
  const players = [...room.players, player]
  const hostId = room.hostId || player.id
  const scores = { ...room.scores, [player.id]: 0 }
  return { room: { ...room, players, hostId, scores }, player }
}

export function reconnectPlayer(room: Room, token: string, socketId: string): Room {
  return {
    ...room,
    players: room.players.map(p => (p.id === token ? { ...p, socketId } : p)),
  }
}

export function removePlayer(room: Room, playerId: string): Room {
  const players = room.players.filter(p => p.id !== playerId)
  const hostId =
    room.hostId === playerId
      ? players.length > 0 ? players[0].id : ''
      : room.hostId
  return { ...room, players, hostId }
}

export function setPlayerConfirmed(room: Room, playerId: string): Room {
  return {
    ...room,
    players: room.players.map(p =>
      p.id === playerId ? { ...p, hasConfirmed: true } : p
    ),
  }
}

export function submitAnswer(room: Room, playerId: string, text: string): Room {
  if (room.players.find(p => p.id === playerId)?.hasSubmitted) return room
  const answer: Answer = { id: randomUUID(), text, authorId: playerId, votes: [] }
  return {
    ...room,
    answers: [...room.answers, answer],
    players: room.players.map(p =>
      p.id === playerId ? { ...p, hasSubmitted: true } : p
    ),
  }
}

export function voteForAnswer(room: Room, playerId: string, answerId: string): Room {
  if (room.players.find(p => p.id === playerId)?.hasVoted) return room
  if (room.answers.find(a => a.id === answerId)?.authorId === playerId) return room
  return {
    ...room,
    answers: room.answers.map(a =>
      a.id === answerId ? { ...a, votes: [...a.votes, playerId] } : a
    ),
    players: room.players.map(p =>
      p.id === playerId ? { ...p, hasVoted: true } : p
    ),
  }
}

export function prepareVoting(room: Room, aiAnswer: Answer): Room {
  const all = [...room.answers, aiAnswer]
  const shuffled = [...all]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return { ...room, state: 'VOTING', answers: shuffled, aiGuesserVote: null }
}

export function applyScoreDeltas(room: Room, deltas: ScoreDeltas): Room {
  const scores = { ...room.scores }
  for (const [id, delta] of Object.entries(deltas)) {
    scores[id] = (scores[id] ?? 0) + delta
  }
  return { ...room, scores }
}

export function resetPerRound(room: Room): Room {
  return {
    ...room,
    answers: [],
    aiGuesserVote: null,
    aiGuesserVoted: false,
    aiSubmitted: false,
    players: room.players.map(p => ({
      ...p,
      hasConfirmed: false,
      hasSubmitted: false,
      hasVoted: false,
    })),
  }
}

export function allConfirmed(room: Room): boolean {
  return room.players.length > 0 && room.players.every(p => p.hasConfirmed)
}

export function allSubmitted(room: Room): boolean {
  return room.players.length > 0 && room.players.every(p => p.hasSubmitted)
}

export function allVoted(room: Room): boolean {
  return room.players.length > 0 && room.players.every(p => p.hasVoted)
}

export function toPublicRoom(room: Room): PublicRoom {
  const hideAuthors = room.state === 'VOTING'
  return {
    ...room,
    answers: room.answers.map(({ authorId, ...rest }) => ({
      ...rest,
      ...(hideAuthors ? {} : { authorId }),
    })),
    aiGuesserVote: hideAuthors ? null : room.aiGuesserVote,
  }
}
