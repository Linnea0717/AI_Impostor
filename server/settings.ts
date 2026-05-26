import { SETTINGS_BOUNDS } from '~shared/config'
import type { GameSettings, EndCondition } from '~shared/types'

export type ParseResult =
  | { ok: true; value: GameSettings }
  | { ok: false; field: string; min?: number; max?: number }

interface RawBody {
  answerInputSec?: unknown
  votingSec?: unknown
  endCondition?: unknown
}

function inRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
}

export function parseSettings(body: RawBody): ParseResult {
  const a = SETTINGS_BOUNDS.answerInputSec
  const v = SETTINGS_BOUNDS.votingSec

  let answerInputSec = a.default
  if (body.answerInputSec !== undefined) {
    if (!inRange(body.answerInputSec, a.min, a.max)) {
      return { ok: false, field: 'answerInputSec', min: a.min, max: a.max }
    }
    answerInputSec = body.answerInputSec
  }

  let votingSec = v.default
  if (body.votingSec !== undefined) {
    if (!inRange(body.votingSec, v.min, v.max)) {
      return { ok: false, field: 'votingSec', min: v.min, max: v.max }
    }
    votingSec = body.votingSec
  }

  let endCondition: EndCondition = { type: 'rounds', value: SETTINGS_BOUNDS.rounds.default }
  if (body.endCondition !== undefined) {
    const ec = body.endCondition as { type?: unknown; value?: unknown }
    if (ec.type === 'rounds') {
      const b = SETTINGS_BOUNDS.rounds
      if (!inRange(ec.value, b.min, b.max)) {
        return { ok: false, field: 'endCondition.value', min: b.min, max: b.max }
      }
      endCondition = { type: 'rounds', value: ec.value }
    } else if (ec.type === 'score') {
      const b = SETTINGS_BOUNDS.score
      if (!inRange(ec.value, b.min, b.max)) {
        return { ok: false, field: 'endCondition.value', min: b.min, max: b.max }
      }
      endCondition = { type: 'score', value: ec.value }
    } else {
      return { ok: false, field: 'endCondition.type' }
    }
  }

  return {
    ok: true,
    value: {
      answerInputMs: answerInputSec * 1000,
      votingMs: votingSec * 1000,
      endCondition,
    },
  }
}
