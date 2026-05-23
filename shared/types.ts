export type GameState =
  | 'LOBBY'
  | 'WORD_GENERATION'
  | 'ANSWER_INPUT'
  | 'VOTING'
  | 'ROUND_RESULT'
  | 'GAME_OVER'

export interface Player {
  id: string         // stable UUID, stored in client localStorage
  socketId: string   // current socket ID, changes on reconnect
  nickname: string
  hasConfirmed: boolean  // ready in LOBBY / continue in ROUND_RESULT
  hasSubmitted: boolean
  hasVoted: boolean
}

export interface Answer {
  id: string
  text: string
  authorId: string   // player UUID or 'AI'
  votes: string[]    // voter player UUIDs
}

export interface Room {
  code: string
  hostId: string
  questionPool: string
  questionPoolName: string
  players: Player[]
  state: GameState
  round: number
  maxRounds: number
  currentWord: string
  answers: Answer[]
  aiGuesserVote: string | null  // answerId or 'TIMEOUT'; null during VOTING
  aiGuesserVoted: boolean       // true when AI guesser has cast its vote (hidden from clients during VOTING)
  aiSubmitted: boolean          // true when AI definition is ready during ANSWER_INPUT
  scores: Record<string, number>
  timerEndsAt: number  // unix ms; clients calculate countdown locally
}

// Sent to clients — authorId hidden during VOTING
export type PublicAnswer = Omit<Answer, 'authorId'> & { authorId?: string }
export type PublicRoom = Omit<Room, 'answers'> & { answers: PublicAnswer[] }
