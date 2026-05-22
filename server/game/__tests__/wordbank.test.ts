import { describe, it, expect } from 'vitest'
import { listPools, loadPool, pickWord } from '../wordbank'

describe('listPools', () => {
  it('returns pool names without .json extension', () => {
    const pools = listPools()
    expect(pools).toContain('rare')
    expect(pools).toContain('common')
    expect(pools.every(p => !p.endsWith('.json'))).toBe(true)
  })
})

describe('loadPool', () => {
  it('loads a pool by name and returns entries with word and fallback', () => {
    const pool = loadPool('rare')
    expect(pool.length).toBeGreaterThan(0)
    expect(pool[0]).toHaveProperty('word')
    expect(pool[0]).toHaveProperty('fallback')
  })

  it('throws if pool name does not exist', () => {
    expect(() => loadPool('nonexistent')).toThrow()
  })
})

describe('pickWord', () => {
  it('returns an entry from the pool', () => {
    const pool = loadPool('rare')
    const used = new Set<string>()
    const entry = pickWord(pool, used)
    expect(pool.some(e => e.word === entry.word)).toBe(true)
  })

  it('does not return used words until all are exhausted', () => {
    const pool = loadPool('rare')
    const used = new Set<string>()
    const picked = new Set<string>()
    for (let i = 0; i < pool.length; i++) {
      const entry = pickWord(pool, used)
      expect(picked.has(entry.word)).toBe(false)
      picked.add(entry.word)
      used.add(entry.word)
    }
  })

  it('resets and picks again when all words are used', () => {
    const pool = loadPool('rare')
    const used = new Set(pool.map(e => e.word))
    const entry = pickWord(pool, used)
    expect(pool.some(e => e.word === entry.word)).toBe(true)
    expect(used.size).toBe(0)  // used set was cleared
  })
})
