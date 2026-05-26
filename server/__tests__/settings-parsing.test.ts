import { describe, it, expect } from 'vitest'
import { parseSettings } from '../settings'

describe('parseSettings', () => {
  it('returns defaults when body is empty', () => {
    const result = parseSettings({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.answerInputMs).toBe(90_000)
    expect(result.value.votingMs).toBe(45_000)
    expect(result.value.endCondition).toEqual({ type: 'rounds', value: 5 })
  })

  it('accepts in-range values and converts seconds to ms', () => {
    const result = parseSettings({
      answerInputSec: 120,
      votingSec: 30,
      endCondition: { type: 'score', value: 20 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.answerInputMs).toBe(120_000)
    expect(result.value.votingMs).toBe(30_000)
    expect(result.value.endCondition).toEqual({ type: 'score', value: 20 })
  })

  it('rejects answerInputSec below the minimum', () => {
    const result = parseSettings({ answerInputSec: 10 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('answerInputSec')
  })

  it('rejects votingSec above the maximum', () => {
    const result = parseSettings({ votingSec: 999 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('votingSec')
  })

  it('rejects rounds out of range', () => {
    const result = parseSettings({ endCondition: { type: 'rounds', value: 1 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('endCondition.value')
  })

  it('rejects score out of range', () => {
    const result = parseSettings({ endCondition: { type: 'score', value: 100 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('endCondition.value')
  })

  it('rejects unknown endCondition type', () => {
    const result = parseSettings({ endCondition: { type: 'nonsense', value: 5 } as never })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('endCondition.type')
  })
})
