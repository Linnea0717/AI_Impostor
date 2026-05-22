import { describe, it, expect } from 'vitest'
import { calculateRoundScores } from '../scoring'
import type { Answer, Player } from '~shared/types'

function makePlayer(id: string): Player {
  return { id, socketId: '', nickname: id, hasConfirmed: false, hasSubmitted: true, hasVoted: true }
}

const AI_ANSWER: Answer = { id: 'ai-1', text: 'AI text', authorId: 'AI', votes: [] }

describe('calculateRoundScores', () => {
  it('awards +1 per vote received on a fake answer', () => {
    const alice = makePlayer('alice')
    const bob = makePlayer('bob')
    const answers: Answer[] = [
      { id: 'a1', text: 'Alice text', authorId: 'alice', votes: ['bob'] },
      { id: 'a2', text: 'Bob text', authorId: 'bob', votes: [] },
      { ...AI_ANSWER, votes: [] },
    ]
    const deltas = calculateRoundScores(answers, [alice, bob])
    expect(deltas['alice']).toBe(2)  // +1 (bob voted) + +1 (AI wins)
    expect(deltas['bob']).toBe(1)    // +1 (AI wins)
  })

  it('awards +2 for correctly identifying the AI answer', () => {
    const alice = makePlayer('alice')
    const answers: Answer[] = [
      { id: 'a1', text: 'Alice text', authorId: 'alice', votes: [] },
      { ...AI_ANSWER, votes: ['alice'] },
    ]
    const deltas = calculateRoundScores(answers, [alice])
    expect(deltas['alice']).toBe(2)
  })

  it('awards +1 to all submitters when nobody finds the AI', () => {
    const alice = makePlayer('alice')
    const bob = makePlayer('bob')
    const answers: Answer[] = [
      { id: 'a1', text: 'Alice text', authorId: 'alice', votes: ['bob'] },
      { id: 'a2', text: 'Bob text', authorId: 'bob', votes: [] },
      { ...AI_ANSWER, votes: [] },
    ]
    const deltas = calculateRoundScores(answers, [alice, bob])
    // alice gets +1 (vote) + +1 (AI wins) = 2; bob gets +1 (AI wins) = 1
    expect(deltas['alice']).toBe(2)
    expect(deltas['bob']).toBe(1)
  })

  it('combines all bonuses in the same round', () => {
    const alice = makePlayer('alice')
    const bob = makePlayer('bob')
    const carol = makePlayer('carol')
    const answers: Answer[] = [
      { id: 'a1', text: 'Alice text', authorId: 'alice', votes: ['bob'] },
      { id: 'a2', text: 'Bob text', authorId: 'bob', votes: [] },
      { id: 'a3', text: 'Carol text', authorId: 'carol', votes: [] },
      { ...AI_ANSWER, votes: ['alice', 'carol'] },
    ]
    const deltas = calculateRoundScores(answers, [alice, bob, carol])
    expect(deltas['alice']).toBe(3)  // +1 (bob voted) + +2 (found AI)
    expect(deltas['bob']).toBe(0)
    expect(deltas['carol']).toBe(2)  // +2 (found AI)
  })
})
