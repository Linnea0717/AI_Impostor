import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const POOLS_DIR = join(__dirname, '../data/pools')

export interface WordEntry {
  word: string
  fallback: string
}

export function listPools(): string[] {
  return readdirSync(POOLS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
}

export function loadPool(poolName: string): WordEntry[] {
  const filePath = join(POOLS_DIR, `${poolName}.json`)
  return JSON.parse(readFileSync(filePath, 'utf-8')) as WordEntry[]
}

export function pickWord(pool: WordEntry[], usedWords: Set<string>): WordEntry {
  let available = pool.filter(e => !usedWords.has(e.word))
  if (available.length === 0) {
    usedWords.clear()
    available = pool
  }
  return available[Math.floor(Math.random() * available.length)]
}
