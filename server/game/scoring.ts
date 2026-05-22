import type { Answer, Player } from '~shared/types'

export interface ScoreDeltas {
  [playerId: string]: number
}

export function calculateRoundScores(answers: Answer[], players: Player[]): ScoreDeltas {
  const deltas: ScoreDeltas = {}
  for (const p of players) deltas[p.id] = 0

  const aiAnswer = answers.find(a => a.authorId === 'AI')!

  // +1 per vote received on your fake answer
  for (const answer of answers) {
    if (answer.authorId === 'AI') continue
    for (const _voterId of answer.votes) {
      deltas[answer.authorId] = (deltas[answer.authorId] ?? 0) + 1
    }
  }

  // +2 if you correctly identified the AI answer
  for (const voterId of aiAnswer.votes) {
    deltas[voterId] = (deltas[voterId] ?? 0) + 2
  }

  // +1 to all submitters if nobody found the AI
  if (aiAnswer.votes.length === 0) {
    for (const p of players) {
      if (p.hasSubmitted) deltas[p.id] = (deltas[p.id] ?? 0) + 1
    }
  }

  return deltas
}
