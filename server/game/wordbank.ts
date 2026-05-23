import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const POOLS_DIR = join(__dirname, '../data/pools')

export interface WordEntry {
  word: string
  fallback: string
}

export interface PoolMeta {
  id: string
  name: string
}

interface PoolFile {
  name: string
  words: WordEntry[]
}

export function listPools(): PoolMeta[] {
  return readdirSync(POOLS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const id = f.replace('.json', '')
      const file = JSON.parse(readFileSync(join(POOLS_DIR, f), 'utf-8')) as PoolFile
      return { id, name: file.name ?? id }
    })
}

export function loadPool(poolId: string): WordEntry[] {
  const filePath = join(POOLS_DIR, `${poolId}.json`)
  const file = JSON.parse(readFileSync(filePath, 'utf-8')) as PoolFile
  return file.words
}

export function pickWord(pool: WordEntry[], usedWords: Set<string>): WordEntry {
  let available = pool.filter(e => !usedWords.has(e.word))
  if (available.length === 0) {
    usedWords.clear()
    available = pool
  }
  return available[Math.floor(Math.random() * available.length)]
}
