// shared/config.ts
export const SETTINGS_BOUNDS = {
  answerInputSec: { min: 30, max: 180, default: 90 },
  votingSec:      { min: 20, max: 90,  default: 45 },
  rounds:         { min: 3,  max: 10,  default: 5 },
  score:          { min: 5,  max: 30,  default: 15 },
} as const

export const ROOM_CODE_LENGTH = 4
export const SCORE_MODE_SAFETY_CAP = 30
