import { describe, it, expect } from 'vitest'
import {
  createRoom, addPlayer, removePlayer, reconnectPlayer,
  setPlayerConfirmed, submitAnswer, voteForAnswer, prepareVoting,
  applyScoreDeltas, resetPerRound,
  allConfirmed, allSubmitted, allVoted, toPublicRoom,
} from '../room'
import type { Answer } from '~shared/types'
import type { GameSettings } from '~shared/types'

function makeTestSettings(): GameSettings {
  return {
    answerInputMs: 90_000,
    votingMs: 45_000,
    endCondition: { type: 'rounds', value: 5 },
  }
}

describe('createRoom', () => {
  it('creates a room in LOBBY state with correct defaults', () => {
    const room = createRoom('rare', '罕見詞', makeTestSettings())
    expect(room.state).toBe('LOBBY')
    expect(room.questionPool).toBe('rare')
    expect(room.round).toBe(0)
    expect(room.settings.endCondition).toEqual({ type: 'rounds', value: 5 })
    expect(room.players).toHaveLength(0)
    expect(room.code).toMatch(/^[0-9]{4}$/)
  })

  it('generates a 4-digit numeric room code', () => {
    const room = createRoom('rare', '罕見詞', makeTestSettings())
    expect(room.code).toMatch(/^[0-9]{4}$/)
  })
})

describe('addPlayer', () => {
  it('adds a player and makes them host if first', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r, player } = addPlayer(room, 'Alice', undefined, 'socket-1')
    expect(r.players).toHaveLength(1)
    expect(r.hostId).toBe(player.id)
    expect(player.nickname).toBe('Alice')
  })

  it('does not change host when second player joins', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const { room: r2 } = addPlayer(r1, 'Bob', undefined, 'socket-2')
    expect(r2.hostId).toBe(p1.id)
  })

  it('reuses existing player id when token matches (reconnect path)', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Alice', player.id, 'socket-2')
    expect(r2.players).toHaveLength(1)
    expect(p2.id).toBe(player.id)
    expect(p2.socketId).toBe('socket-2')
  })
})

describe('removePlayer', () => {
  it('removes a player from the list', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const r2 = removePlayer(r1, player.id)
    expect(r2.players).toHaveLength(0)
  })

  it('promotes next player to host when host is removed', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 'socket-2')
    const r3 = removePlayer(r2, p1.id)
    expect(r3.hostId).toBe(p2.id)
  })
})

describe('setPlayerConfirmed / allConfirmed', () => {
  it('marks a player as confirmed', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = setPlayerConfirmed(r1, player.id)
    expect(r2.players[0].hasConfirmed).toBe(true)
  })

  it('allConfirmed returns true only when all players are confirmed', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 's1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 's2')
    expect(allConfirmed(r2)).toBe(false)
    const r3 = setPlayerConfirmed(r2, p1.id)
    expect(allConfirmed(r3)).toBe(false)
    const r4 = setPlayerConfirmed(r3, p2.id)
    expect(allConfirmed(r4)).toBe(true)
  })
})

describe('submitAnswer / allSubmitted', () => {
  it('records a player answer', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'My fake answer')
    expect(r2.answers).toHaveLength(1)
    expect(r2.answers[0].text).toBe('My fake answer')
    expect(r2.answers[0].authorId).toBe(player.id)
    expect(r2.players[0].hasSubmitted).toBe(true)
  })

  it('ignores duplicate submissions from the same player', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'First')
    const r3 = submitAnswer(r2, player.id, 'Second')
    expect(r3.answers).toHaveLength(1)
    expect(r3.answers[0].text).toBe('First')
  })
})

describe('voteForAnswer / allVoted', () => {
  it('records a vote', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 's1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 's2')
    const r3 = submitAnswer(r2, p2.id, 'Bob answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r4 = prepareVoting(r3, aiAnswer)
    const r5 = voteForAnswer(r4, p1.id, r4.answers[0].id)
    expect(r5.answers.some(a => a.votes.includes(p1.id))).toBe(true)
    expect(r5.players.find(p => p.id === p1.id)!.hasVoted).toBe(true)
  })
})

describe('toPublicRoom', () => {
  it('strips authorId from answers during VOTING', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'My answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r3 = prepareVoting(r2, aiAnswer)
    const pub = toPublicRoom(r3)
    expect(pub.state).toBe('VOTING')
    pub.answers.forEach(a => expect(a.authorId).toBeUndefined())
    expect(pub.aiGuesserVote).toBeNull()
  })

  it('includes authorId in ROUND_RESULT', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'My answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r3 = { ...prepareVoting(r2, aiAnswer), state: 'ROUND_RESULT' as const }
    const pub = toPublicRoom(r3)
    pub.answers.forEach(a => expect(a.authorId).toBeDefined())
  })

  it('hides currentWordCorrect outside ROUND_RESULT', () => {
    const base = createRoom('rare', '罕見詞', makeTestSettings())
    const r = { ...base, state: 'ANSWER_INPUT' as const, currentWordCorrect: '真實解答' }
    const pub = toPublicRoom(r)
    expect(pub.currentWordCorrect).toBe('')
  })

  it('reveals currentWordCorrect during ROUND_RESULT', () => {
    const base = createRoom('rare', '罕見詞', makeTestSettings())
    const r = { ...base, state: 'ROUND_RESULT' as const, currentWordCorrect: '真實解答' }
    const pub = toPublicRoom(r)
    expect(pub.currentWordCorrect).toBe('真實解答')
  })
})

describe('resetPerRound', () => {
  it('clears per-round fields but keeps scores', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = { ...r1, scores: { [player.id]: 10 } }
    const r3 = resetPerRound(r2)
    expect(r3.answers).toHaveLength(0)
    expect(r3.aiGuesserVote).toBeNull()
    expect(r3.players[0].hasConfirmed).toBe(false)
    expect(r3.players[0].hasSubmitted).toBe(false)
    expect(r3.players[0].hasVoted).toBe(false)
    expect(r3.scores[player.id]).toBe(10)  // scores preserved
  })
})

describe('reconnectPlayer', () => {
  it('updates socketId for the matching player', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const r2 = reconnectPlayer(r1, player.id, 'socket-new')
    expect(r2.players[0].socketId).toBe('socket-new')
  })
})

describe('applyScoreDeltas', () => {
  it('adds deltas to existing scores', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = applyScoreDeltas(r1, { [player.id]: 3 })
    expect(r2.scores[player.id]).toBe(3)
  })

  it('accumulates on top of existing score', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = applyScoreDeltas(r1, { [player.id]: 3 })
    const r3 = applyScoreDeltas(r2, { [player.id]: 2 })
    expect(r3.scores[player.id]).toBe(5)
  })
})

describe('allVoted', () => {
  it('returns false when no players', () => {
    const room = createRoom('rare', '罕見詞', makeTestSettings())
    expect(allVoted(room)).toBe(false)
  })

  it('returns true when all players have voted', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 's1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 's2')
    const r3 = submitAnswer(r2, p2.id, 'Bob answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r4 = prepareVoting(r3, aiAnswer)
    expect(allVoted(r4)).toBe(false)
    const r5 = voteForAnswer(r4, p1.id, r4.answers[0].id)
    expect(allVoted(r5)).toBe(false)
    const notP2sAnswer = r5.answers.find(a => a.authorId !== p2.id)!
    const r6 = voteForAnswer(r5, p2.id, notP2sAnswer.id)
    expect(allVoted(r6)).toBe(true)
  })
})

describe('allConfirmed / allSubmitted empty-room guard', () => {
  it('allConfirmed returns false for empty room', () => {
    expect(allConfirmed(createRoom('rare', '罕見詞', makeTestSettings()))).toBe(false)
  })

  it('allSubmitted returns false for empty room', () => {
    expect(allSubmitted(createRoom('rare', '罕見詞', makeTestSettings()))).toBe(false)
  })
})

describe('voteForAnswer self-vote guard', () => {
  it('ignores a vote for the player\'s own answer', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 's1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 's2')
    const r3 = submitAnswer(r2, p1.id, 'Alice answer')
    const r4 = submitAnswer(r3, p2.id, 'Bob answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r5 = prepareVoting(r4, aiAnswer)
    const aliceAnswer = r5.answers.find(a => a.authorId === p1.id)!
    const r6 = voteForAnswer(r5, p1.id, aliceAnswer.id)
    expect(r6.players.find(p => p.id === p1.id)!.hasVoted).toBe(false)
    expect(aliceAnswer.votes).toHaveLength(0)
  })
})

describe('voteForAnswer duplicate guard', () => {
  it('ignores a second vote from the same player', () => {
    let room = createRoom('rare', '罕見詞', makeTestSettings())
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 's1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 's2')
    const r3 = submitAnswer(r2, p2.id, 'Bob answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r4 = prepareVoting(r3, aiAnswer)
    const firstAnswerId = r4.answers[0].id
    const r5 = voteForAnswer(r4, p1.id, firstAnswerId)
    const r6 = voteForAnswer(r5, p1.id, r5.answers[1].id)  // second vote — should be ignored
    const totalVotesForP1 = r6.answers.reduce((sum, a) => sum + a.votes.filter(id => id === p1.id).length, 0)
    expect(totalVotesForP1).toBe(1)
  })
})
