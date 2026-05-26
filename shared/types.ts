export type GameState =
  | 'LOBBY'
  | 'WORD_GENERATION'
  | 'ANSWER_INPUT'
  | 'VOTING'
  | 'ROUND_RESULT'
  | 'GAME_OVER'

export interface Player {
  id: string
  socketId: string
  nickname: string
  hasConfirmed: boolean
  hasSubmitted: boolean
  hasVoted: boolean
}

export interface Answer {
  id: string
  text: string
  authorId: string
  votes: string[]
}

export type EndCondition =
  | { type: 'rounds'; value: number }
  | { type: 'score';  value: number }

export interface GameSettings {
  answerInputMs: number
  votingMs: number
  endCondition: EndCondition
}

export interface Room {
  code: string
  hostId: string
  questionPool: string
  questionPoolName: string
  players: Player[]
  state: GameState
  round: number
  settings: GameSettings
  currentWord: string
  currentWordCorrect: string
  answers: Answer[]
  aiGuesserVote: string | null
  aiGuesserVoted: boolean
  aiSubmitted: boolean
  scores: Record<string, number>
  timerEndsAt: number
}

export type PublicAnswer = Omit<Answer, 'authorId'> & { authorId?: string }
export type PublicRoom = Omit<Room, 'answers'> & { answers: PublicAnswer[] }
