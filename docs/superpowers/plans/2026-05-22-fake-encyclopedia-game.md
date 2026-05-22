# 偽百科詞典 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time multiplayer party game where players submit fake encyclopedia definitions and vote to identify the AI-generated one.

**Architecture:** Express + Socket.io server owns all game state as in-memory `Map<string, Room>`. All room-state functions in `room.ts` are pure/synchronous (easy to test); `index.ts` orchestrates the async work (LLM calls, timers, socket emissions). The Vite client is a pure render layer that reacts to `room:state-update` events.

**Tech Stack:** Node.js 20+, Express 4, Socket.io 4, Vite 5, TypeScript 5, Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai`), vitest

---

## File Map

| File | Responsibility |
|---|---|
| `shared/types.ts` | All interfaces shared by client + server |
| `server/game/scoring.ts` | Pure scoring calculation |
| `server/game/wordbank.ts` | Pool file loading and word picking |
| `server/game/room.ts` | Pure/synchronous room state machine |
| `server/llm/provider.ts` | Vercel AI SDK wrapper (`generateDefinition`, `guessDefinition`) |
| `server/index.ts` | Express REST + Socket.io event handlers, timers, LLM orchestration |
| `client/src/socket.ts` | Socket.io client wrapper + emit helpers |
| `client/src/main.ts` | Home screen (create/join) + state-based screen router |
| `client/src/screens/lobby.ts` | Lobby render |
| `client/src/screens/answer.ts` | Answer input + countdown |
| `client/src/screens/voting.ts` | Anonymous answer voting |
| `client/src/screens/results.ts` | Author reveal + AI guesser comparison |
| `client/src/screens/gameover.ts` | Final leaderboard |
| `server/data/definition-prompt.txt` | Persona prefix for definition LLM |
| `server/data/pools/*.json` | Word pool files |
| `.env.example` | LLM config template |

---

## Task 1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `client/package.json`
- Create: `client/tsconfig.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "fake-encyclopedia",
  "private": true,
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev": "concurrently \"npm run dev --workspace=server\" \"npm run dev --workspace=client\"",
    "test": "npm run test --workspace=server"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

- [ ] **Step 2: Create shared/package.json**

```json
{
  "name": "fake-encyclopedia-shared",
  "version": "1.0.0",
  "main": "./types.ts",
  "types": "./types.ts"
}
```

- [ ] **Step 3: Create shared/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

- [ ] **Step 4: Create server/package.json**

```json
{
  "name": "fake-encyclopedia-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "ai": "^4.3.0",
    "@ai-sdk/anthropic": "^1.2.0",
    "@ai-sdk/openai": "^1.3.0",
    "dotenv": "^16.4.0",
    "express": "^4.19.0",
    "socket.io": "^4.7.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 5: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "./dist",
    "rootDir": ".",
    "paths": {
      "~shared/*": ["../shared/*"]
    }
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 6: Create server/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '~shared': resolve(__dirname, '../shared'),
    },
  },
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 7: Create client/package.json**

```json
{
  "name": "fake-encyclopedia-client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "socket.io-client": "^4.7.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.3.0"
  }
}
```

- [ ] **Step 8: Create client/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "paths": {
      "~shared/*": ["../../shared/*"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 9: Create directories and install**

```bash
mkdir -p shared server/game server/llm server/data/pools server/__tests__ client/src/screens
cd /path/to/project && npm install
```

Expected: `node_modules/` in root, server, and client. No errors.

- [ ] **Step 10: Commit**

```bash
git init
git add .
git commit -m "chore: initialize monorepo structure"
```

---

## Task 2: Shared Types

**Files:**
- Create: `shared/types.ts`

- [ ] **Step 1: Create shared/types.ts**

```typescript
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
  players: Player[]
  state: GameState
  round: number
  maxRounds: number
  currentWord: string
  answers: Answer[]
  aiGuesserVote: string | null  // answerId or 'TIMEOUT'; null during VOTING
  scores: Record<string, number>
  timerEndsAt: number  // unix ms; clients calculate countdown locally
}

// Sent to clients — authorId hidden during VOTING
export type PublicAnswer = Omit<Answer, 'authorId'> & { authorId?: string }
export type PublicRoom = Omit<Room, 'answers'> & { answers: PublicAnswer[] }
```

- [ ] **Step 2: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add shared TypeScript types"
```

---

## Task 3: Scoring Module (TDD)

**Files:**
- Create: `server/game/__tests__/scoring.test.ts`
- Create: `server/game/scoring.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// server/game/__tests__/scoring.test.ts
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
    expect(deltas['alice']).toBe(1)
    expect(deltas['bob']).toBe(0)
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
    // alice's answer gets bob's vote (+1)
    // alice and carol vote for AI (+2 each)
    // AI has voters so no AI-wins bonus
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd server && npx vitest run game/__tests__/scoring.test.ts
```

Expected: `Error: Cannot find module '../scoring'`

- [ ] **Step 3: Implement scoring.ts**

```typescript
// server/game/scoring.ts
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd server && npx vitest run game/__tests__/scoring.test.ts
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add server/game/scoring.ts server/game/__tests__/scoring.test.ts
git commit -m "feat: scoring module with TDD"
```

---

## Task 4: Word Bank Module (TDD)

**Files:**
- Create: `server/data/pools/rare.json`
- Create: `server/data/pools/common.json`
- Create: `server/game/__tests__/wordbank.test.ts`
- Create: `server/game/wordbank.ts`

- [ ] **Step 1: Create sample pool files**

```json
// server/data/pools/rare.json
[
  { "word": "量子糾纏麵包", "fallback": "一種理論性烘焙概念，指兩條麵包進入量子糾纏狀態，使其中一條的新鮮程度能瞬間影響另一條，無論兩者相距多遠。" },
  { "word": "卡夫卡效應", "fallback": "指當事人在官僚體系中反覆填寫相同表格卻永遠無法完成手續的心理麻痺現象，最早由布拉格行政學院提出。" },
  { "word": "反語寂靜症", "fallback": "一種罕見的語言障礙，患者在試圖說反話時反而說出真心話，目前無有效治療方式。" }
]
```

```json
// server/data/pools/common.json
[
  { "word": "蝴蝶效應麵包機", "fallback": "一種烤麵包機，其吐司彈出的角度會影響鄰近城市的天氣，目前仍在專利申請階段。" },
  { "word": "逆向懷舊", "fallback": "一種心理現象，指對於從未經歷過的過去年代感到強烈思念，常見於千禧世代。" },
  { "word": "重力三溫暖", "fallback": "利用局部重力場變化製造冷熱交替效果的三溫暖技術，由日本溫泉工業於 2019 年取得專利。" }
]
```

- [ ] **Step 2: Write failing tests**

```typescript
// server/game/__tests__/wordbank.test.ts
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
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd server && npx vitest run game/__tests__/wordbank.test.ts
```

Expected: `Error: Cannot find module '../wordbank'`

- [ ] **Step 4: Implement wordbank.ts**

```typescript
// server/game/wordbank.ts
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
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd server && npx vitest run game/__tests__/wordbank.test.ts
```

Expected: `6 passed`

- [ ] **Step 6: Commit**

```bash
git add server/game/wordbank.ts server/game/__tests__/wordbank.test.ts server/data/pools/
git commit -m "feat: word bank module with TDD"
```

---

## Task 5: LLM Provider (TDD)

**Files:**
- Create: `server/data/definition-prompt.txt`
- Create: `server/llm/__tests__/provider.test.ts`
- Create: `server/llm/provider.ts`

- [ ] **Step 1: Create definition-prompt.txt**

```
你是一個台灣年輕人，講話很隨性、愛用網路用語，有時候會夾雜一些英文。
你現在要假裝自己知道一個詞彙的意思，然後用自信但其實是瞎掰的方式解釋它。
不要說「我認為」或「可能是」，直接用肯定的口氣解釋，讓人覺得你真的懂。
```

- [ ] **Step 2: Write failing tests**

```typescript
// server/llm/__tests__/provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the 'ai' module before importing provider
vi.mock('ai', () => ({
  generateText: vi.fn(),
}))
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn(() => 'mock-anthropic-model'),
}))
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn(() => 'mock-openai-model'),
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-ollama-model')),
}))

import { generateText } from 'ai'
import { generateDefinition, guessDefinition } from '../provider'

const mockGenerateText = vi.mocked(generateText)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.LLM_PROVIDER = 'anthropic'
  process.env.LLM_MODEL = 'claude-haiku-4-5-20251001'
})

describe('generateDefinition', () => {
  it('returns trimmed text from the LLM', async () => {
    mockGenerateText.mockResolvedValue({ text: '  這是一個很厲害的東西  ' } as any)
    const result = await generateDefinition('量子糾纏麵包')
    expect(result).toBe('這是一個很厲害的東西')
  })

  it('includes the word in the prompt', async () => {
    mockGenerateText.mockResolvedValue({ text: 'def' } as any)
    await generateDefinition('量子糾纏麵包')
    const call = mockGenerateText.mock.calls[0][0]
    expect((call as any).prompt).toContain('量子糾纏麵包')
  })

  it('throws when LLM call fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('API error'))
    await expect(generateDefinition('test')).rejects.toThrow()
  })
})

describe('guessDefinition', () => {
  it('returns an answerId from the provided list', async () => {
    const answers = [
      { id: 'uuid-1', text: 'first answer' },
      { id: 'uuid-2', text: 'second answer' },
    ]
    mockGenerateText.mockResolvedValue({ text: 'uuid-1' } as any)
    const result = await guessDefinition(answers)
    expect(result).toBe('uuid-1')
  })

  it('falls back to first answer if LLM returns an unrecognised ID', async () => {
    const answers = [
      { id: 'uuid-1', text: 'first answer' },
      { id: 'uuid-2', text: 'second answer' },
    ]
    mockGenerateText.mockResolvedValue({ text: 'not-a-valid-id' } as any)
    const result = await guessDefinition(answers)
    expect(result).toBe('uuid-1')
  })

  it('throws when LLM call fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('API error'))
    await expect(guessDefinition([{ id: 'x', text: 'y' }])).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd server && npx vitest run llm/__tests__/provider.test.ts
```

Expected: `Error: Cannot find module '../provider'`

- [ ] **Step 4: Implement provider.ts**

```typescript
// server/llm/provider.ts
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai, createOpenAI } from '@ai-sdk/openai'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const promptPrefix = readFileSync(
  join(__dirname, '../data/definition-prompt.txt'),
  'utf-8'
).trim()

function getModel() {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  const model = process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001'
  if (provider === 'openai') return openai(model)
  if (provider === 'ollama') {
    const ollamaClient = createOpenAI({
      baseURL: (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434') + '/v1',
    })
    return ollamaClient(model)
  }
  return anthropic(model)
}

export async function generateDefinition(word: string): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    prompt: `${promptPrefix}\n\n現在請用上述風格，為以下詞彙寫一段假定義，不要超過兩句：\n詞彙：${word}`,
    maxTokens: 200,
  })
  return text.trim()
}

export async function guessDefinition(
  answers: { id: string; text: string }[]
): Promise<string> {
  const formatted = answers
    .map((a, i) => `${i + 1}. [ID: ${a.id}] ${a.text}`)
    .join('\n')
  const { text } = await generateText({
    model: getModel(),
    prompt: `以下是幾則對某個詞彙的解釋，其中一則是由 AI 生成的。請判斷哪一則最像 AI 所寫（通常過於工整、學術、正式），並只回覆該則的 ID（格式為 UUID，不要包含任何其他文字）：\n\n${formatted}`,
    maxTokens: 50,
  })
  const guessedId = text.trim()
  return answers.find(a => a.id === guessedId) ? guessedId : answers[0].id
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd server && npx vitest run llm/__tests__/provider.test.ts
```

Expected: `6 passed`

- [ ] **Step 6: Commit**

```bash
git add server/llm/ server/data/definition-prompt.txt
git commit -m "feat: LLM provider with generateDefinition and guessDefinition"
```

---

## Task 6: Room State Machine (TDD)

**Files:**
- Create: `server/game/__tests__/room.test.ts`
- Create: `server/game/room.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// server/game/__tests__/room.test.ts
import { describe, it, expect } from 'vitest'
import {
  createRoom, addPlayer, removePlayer, reconnectPlayer,
  setPlayerConfirmed, submitAnswer, voteForAnswer, prepareVoting,
  applyScoreDeltas, resetPerRound,
  allConfirmed, allSubmitted, allVoted, toPublicRoom,
} from '../room'
import type { Answer } from '~shared/types'

describe('createRoom', () => {
  it('creates a room in LOBBY state with correct defaults', () => {
    const room = createRoom('rare')
    expect(room.state).toBe('LOBBY')
    expect(room.questionPool).toBe('rare')
    expect(room.round).toBe(0)
    expect(room.maxRounds).toBe(5)
    expect(room.players).toHaveLength(0)
    expect(room.code).toMatch(/^[A-Z0-9]{5}$/)
  })
})

describe('addPlayer', () => {
  it('adds a player and makes them host if first', () => {
    let room = createRoom('rare')
    const { room: r, player } = addPlayer(room, 'Alice', undefined, 'socket-1')
    expect(r.players).toHaveLength(1)
    expect(r.hostId).toBe(player.id)
    expect(player.nickname).toBe('Alice')
  })

  it('does not change host when second player joins', () => {
    let room = createRoom('rare')
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const { room: r2 } = addPlayer(r1, 'Bob', undefined, 'socket-2')
    expect(r2.hostId).toBe(p1.id)
  })

  it('reuses existing player id when token matches (reconnect path)', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Alice', player.id, 'socket-2')
    expect(r2.players).toHaveLength(1)
    expect(p2.id).toBe(player.id)
    expect(p2.socketId).toBe('socket-2')
  })
})

describe('removePlayer', () => {
  it('removes a player from the list', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const r2 = removePlayer(r1, player.id)
    expect(r2.players).toHaveLength(0)
  })

  it('promotes next player to host when host is removed', () => {
    let room = createRoom('rare')
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 'socket-1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 'socket-2')
    const r3 = removePlayer(r2, p1.id)
    expect(r3.hostId).toBe(p2.id)
  })
})

describe('setPlayerConfirmed / allConfirmed', () => {
  it('marks a player as confirmed', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = setPlayerConfirmed(r1, player.id)
    expect(r2.players[0].hasConfirmed).toBe(true)
  })

  it('allConfirmed returns true only when all players are confirmed', () => {
    let room = createRoom('rare')
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 's1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 's2')
    expect(allConfirmed(r2)).toBe(false)
    const r3 = setPlayerConfirmed(r2, p1.id)
    expect(allConfirmed(r3)).toBe(false)
    const r4 = setPlayerConfirmed(r3, p2.id)
    expect(allConfirmed(r4)).toBe(true)
  })
})

describe('submitAnswer / allSubmitted', () => {
  it('records a player answer', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'My fake answer')
    expect(r2.answers).toHaveLength(1)
    expect(r2.answers[0].text).toBe('My fake answer')
    expect(r2.answers[0].authorId).toBe(player.id)
    expect(r2.players[0].hasSubmitted).toBe(true)
  })

  it('ignores duplicate submissions from the same player', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'First')
    const r3 = submitAnswer(r2, player.id, 'Second')
    expect(r3.answers).toHaveLength(1)
    expect(r3.answers[0].text).toBe('First')
  })
})

describe('voteForAnswer / allVoted', () => {
  it('records a vote', () => {
    let room = createRoom('rare')
    const { room: r1, player: p1 } = addPlayer(room, 'Alice', undefined, 's1')
    const { room: r2, player: p2 } = addPlayer(r1, 'Bob', undefined, 's2')
    const r3 = submitAnswer(r2, p2.id, 'Bob answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r4 = prepareVoting(r3, aiAnswer)
    const r5 = voteForAnswer(r4, p1.id, r4.answers[0].id)
    expect(r5.answers.some(a => a.votes.includes(p1.id))).toBe(true)
    expect(r5.players.find(p => p.id === p1.id)!.hasVoted).toBe(true)
  })
})

describe('toPublicRoom', () => {
  it('strips authorId from answers during VOTING', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'My answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r3 = prepareVoting(r2, aiAnswer)
    const pub = toPublicRoom(r3)
    expect(pub.state).toBe('VOTING')
    pub.answers.forEach(a => expect(a.authorId).toBeUndefined())
    expect(pub.aiGuesserVote).toBeNull()
  })

  it('includes authorId in ROUND_RESULT', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = submitAnswer(r1, player.id, 'My answer')
    const aiAnswer: Answer = { id: 'ai-1', text: 'AI answer', authorId: 'AI', votes: [] }
    const r3 = { ...prepareVoting(r2, aiAnswer), state: 'ROUND_RESULT' as const }
    const pub = toPublicRoom(r3)
    pub.answers.forEach(a => expect(a.authorId).toBeDefined())
  })
})

describe('resetPerRound', () => {
  it('clears per-round fields but keeps scores', () => {
    let room = createRoom('rare')
    const { room: r1, player } = addPlayer(room, 'Alice', undefined, 's1')
    const r2 = { ...r1, scores: { [player.id]: 10 } }
    const r3 = resetPerRound(r2)
    expect(r3.answers).toHaveLength(0)
    expect(r3.aiGuesserVote).toBeNull()
    expect(r3.players[0].hasConfirmed).toBe(false)
    expect(r3.players[0].hasSubmitted).toBe(false)
    expect(r3.players[0].hasVoted).toBe(false)
    expect(r3.scores[player.id]).toBe(10)  // scores preserved
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd server && npx vitest run game/__tests__/room.test.ts
```

Expected: `Error: Cannot find module '../room'`

- [ ] **Step 3: Implement room.ts**

```typescript
// server/game/room.ts
import { randomUUID } from 'crypto'
import type { Room, Player, Answer, PublicRoom } from '~shared/types'
import type { ScoreDeltas } from './scoring'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateCode(): string {
  return Array.from({ length: 5 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join('')
}

export function createRoom(questionPool: string): Room {
  return {
    code: generateCode(),
    hostId: '',
    questionPool,
    players: [],
    state: 'LOBBY',
    round: 0,
    maxRounds: 5,
    currentWord: '',
    answers: [],
    aiGuesserVote: null,
    scores: {},
    timerEndsAt: 0,
  }
}

export function addPlayer(
  room: Room,
  nickname: string,
  token: string | undefined,
  socketId: string
): { room: Room; player: Player } {
  // Reconnect path: token matches an existing player
  if (token) {
    const existing = room.players.find(p => p.id === token)
    if (existing) {
      const updated = { ...existing, socketId }
      const players = room.players.map(p => (p.id === token ? updated : p))
      return { room: { ...room, players }, player: updated }
    }
  }

  const player: Player = {
    id: randomUUID(),
    socketId,
    nickname,
    hasConfirmed: false,
    hasSubmitted: false,
    hasVoted: false,
  }
  const players = [...room.players, player]
  const hostId = room.hostId || player.id
  const scores = { ...room.scores, [player.id]: 0 }
  return { room: { ...room, players, hostId, scores }, player }
}

export function reconnectPlayer(room: Room, token: string, socketId: string): Room {
  return {
    ...room,
    players: room.players.map(p => (p.id === token ? { ...p, socketId } : p)),
  }
}

export function removePlayer(room: Room, playerId: string): Room {
  const players = room.players.filter(p => p.id !== playerId)
  const hostId =
    room.hostId === playerId && players.length > 0 ? players[0].id : room.hostId
  return { ...room, players, hostId }
}

export function setPlayerConfirmed(room: Room, playerId: string): Room {
  return {
    ...room,
    players: room.players.map(p =>
      p.id === playerId ? { ...p, hasConfirmed: true } : p
    ),
  }
}

export function submitAnswer(room: Room, playerId: string, text: string): Room {
  if (room.players.find(p => p.id === playerId)?.hasSubmitted) return room
  const answer: Answer = { id: randomUUID(), text, authorId: playerId, votes: [] }
  return {
    ...room,
    answers: [...room.answers, answer],
    players: room.players.map(p =>
      p.id === playerId ? { ...p, hasSubmitted: true } : p
    ),
  }
}

export function voteForAnswer(room: Room, playerId: string, answerId: string): Room {
  if (room.players.find(p => p.id === playerId)?.hasVoted) return room
  return {
    ...room,
    answers: room.answers.map(a =>
      a.id === answerId ? { ...a, votes: [...a.votes, playerId] } : a
    ),
    players: room.players.map(p =>
      p.id === playerId ? { ...p, hasVoted: true } : p
    ),
  }
}

export function prepareVoting(room: Room, aiAnswer: Answer): Room {
  const all = [...room.answers, aiAnswer]
  // Fisher-Yates shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return { ...room, state: 'VOTING', answers: all, aiGuesserVote: null }
}

export function applyScoreDeltas(room: Room, deltas: ScoreDeltas): Room {
  const scores = { ...room.scores }
  for (const [id, delta] of Object.entries(deltas)) {
    scores[id] = (scores[id] ?? 0) + delta
  }
  return { ...room, scores }
}

export function resetPerRound(room: Room): Room {
  return {
    ...room,
    answers: [],
    aiGuesserVote: null,
    players: room.players.map(p => ({
      ...p,
      hasConfirmed: false,
      hasSubmitted: false,
      hasVoted: false,
    })),
  }
}

export function allConfirmed(room: Room): boolean {
  return room.players.length > 0 && room.players.every(p => p.hasConfirmed)
}

export function allSubmitted(room: Room): boolean {
  return room.players.length > 0 && room.players.every(p => p.hasSubmitted)
}

export function allVoted(room: Room): boolean {
  return room.players.length > 0 && room.players.every(p => p.hasVoted)
}

export function toPublicRoom(room: Room): PublicRoom {
  const hideAuthors = room.state === 'VOTING'
  return {
    ...room,
    answers: room.answers.map(({ authorId, ...rest }) => ({
      ...rest,
      ...(hideAuthors ? {} : { authorId }),
    })),
    aiGuesserVote: hideAuthors ? null : room.aiGuesserVote,
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd server && npx vitest run game/__tests__/room.test.ts
```

Expected: `14 passed`

- [ ] **Step 5: Commit**

```bash
git add server/game/room.ts server/game/__tests__/room.test.ts
git commit -m "feat: room state machine with TDD"
```

---

## Task 7: Server Entry Point

**Files:**
- Create: `server/index.ts`

- [ ] **Step 1: Create server/index.ts**

```typescript
// server/index.ts
import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomUUID } from 'crypto'
import {
  createRoom, addPlayer, removePlayer, setPlayerConfirmed,
  submitAnswer, voteForAnswer, prepareVoting, applyScoreDeltas,
  resetPerRound, allConfirmed, allSubmitted, allVoted, toPublicRoom,
} from './game/room'
import { calculateRoundScores } from './game/scoring'
import { listPools, loadPool, pickWord, type WordEntry } from './game/wordbank'
import { generateDefinition, guessDefinition } from './llm/provider'
import type { Room, Answer, PublicRoom } from '~shared/types'

const app = express()
app.use(express.json())
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

// ── In-memory state ────────────────────────────────────────────────
const rooms = new Map<string, Room>()
const wordPools = new Map<string, WordEntry[]>()
const usedWords = new Map<string, Set<string>>()
const pendingAiDefinitions = new Map<string, string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

// ── Helpers ─────────────────────────────────────────────────────────
function broadcast(room: Room) {
  io.to(room.code).emit('room:state-update', toPublicRoom(room))
}

function setTimer(code: string, ms: number, cb: () => void) {
  const old = timers.get(code)
  if (old) clearTimeout(old)
  timers.set(code, setTimeout(cb, ms))
}

function clearTimer(code: string) {
  const t = timers.get(code)
  if (t) { clearTimeout(t); timers.delete(code) }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ])
}

function cleanupRoom(code: string) {
  rooms.delete(code)
  wordPools.delete(code)
  usedWords.delete(code)
  pendingAiDefinitions.delete(code)
  clearTimer(code)
}

// ── State transitions ────────────────────────────────────────────────
async function advanceToWordGeneration(code: string) {
  let room = rooms.get(code)
  // Guard: only advance from LOBBY or ROUND_RESULT — prevents double-execution on race between timer + checkAndAdvance
  if (!room || !['LOBBY', 'ROUND_RESULT'].includes(room.state)) return

  room = resetPerRound(room)
  room = { ...room, state: 'WORD_GENERATION', round: room.round + 1 }
  rooms.set(code, room)
  broadcast(room)

  const pool = wordPools.get(code)!
  const used = usedWords.get(code)!
  const entry = pickWord(pool, used)
  used.add(entry.word)

  let definition: string
  try {
    definition = await withTimeout(generateDefinition(entry.word), 5_000)
  } catch {
    definition = entry.fallback
  }
  pendingAiDefinitions.set(code, definition)

  room = rooms.get(code)
  if (!room || room.state !== 'WORD_GENERATION') return  // guard against race

  room = { ...room, state: 'ANSWER_INPUT', currentWord: entry.word, timerEndsAt: Date.now() + 60_000 }
  rooms.set(code, room)
  broadcast(room)

  setTimer(code, 60_000, () => advanceToVoting(code))
}

async function advanceToVoting(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room || room.state !== 'ANSWER_INPUT') return

  const aiText = pendingAiDefinitions.get(code) ?? '（AI 備援定義）'
  pendingAiDefinitions.delete(code)
  const aiAnswer: Answer = { id: randomUUID(), text: aiText, authorId: 'AI', votes: [] }

  room = prepareVoting(room, aiAnswer)
  room = { ...room, timerEndsAt: Date.now() + 45_000 }
  rooms.set(code, room)
  broadcast(room)

  // AI guesser runs in parallel — result stored when ready, revealed in ROUND_RESULT
  const answersForGuesser = room.answers.map(a => ({ id: a.id, text: a.text }))
  withTimeout(guessDefinition(answersForGuesser), 45_000)
    .then(answerId => {
      const r = rooms.get(code)
      if (!r || r.state !== 'VOTING') return
      rooms.set(code, { ...r, aiGuesserVote: answerId })
    })
    .catch(() => {
      const r = rooms.get(code)
      if (!r || r.state !== 'VOTING') return
      rooms.set(code, { ...r, aiGuesserVote: 'TIMEOUT' })
    })

  setTimer(code, 45_000, () => advanceToRoundResult(code))
}

function advanceToRoundResult(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room || room.state !== 'VOTING') return

  const deltas = calculateRoundScores(room.answers, room.players)
  room = applyScoreDeltas(room, deltas)
  room = { ...room, state: 'ROUND_RESULT', timerEndsAt: Date.now() + 15_000 }
  rooms.set(code, room)
  broadcast(room)

  setTimer(code, 15_000, () => advanceFromRoundResult(code))
}

function advanceFromRoundResult(code: string) {
  const room = rooms.get(code)
  if (!room || room.state !== 'ROUND_RESULT') return
  if (room.round >= room.maxRounds) {
    advanceToGameOver(code)
  } else {
    advanceToWordGeneration(code)
  }
}

function advanceToGameOver(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room) return
  room = { ...room, state: 'GAME_OVER' }
  rooms.set(code, room)
  broadcast(room)
}

function checkAndAdvance(code: string) {
  const room = rooms.get(code)
  if (!room) return
  if ((room.state === 'LOBBY' || room.state === 'ROUND_RESULT') && allConfirmed(room)) {
    clearTimer(code)
    if (room.state === 'LOBBY') advanceToWordGeneration(code)
    else advanceFromRoundResult(code)
  } else if (room.state === 'ANSWER_INPUT' && allSubmitted(room)) {
    advanceToVoting(code)
  } else if (room.state === 'VOTING' && allVoted(room)) {
    advanceToRoundResult(code)
  }
}

// ── REST endpoints ──────────────────────────────────────────────────
app.get('/api/pools', (_req, res) => {
  res.json({ pools: listPools() })
})

app.post('/api/rooms', (req, res) => {
  const { questionPool } = req.body as { questionPool?: string }
  if (!questionPool || !listPools().includes(questionPool)) {
    res.status(400).json({ error: 'Invalid question pool' })
    return
  }
  let room = createRoom(questionPool)
  // Ensure unique code (max 5 attempts)
  let attempts = 0
  while (rooms.has(room.code) && attempts < 5) { room = createRoom(questionPool); attempts++ }
  rooms.set(room.code, room)
  wordPools.set(room.code, loadPool(questionPool))
  usedWords.set(room.code, new Set())
  res.json({ code: room.code })
})

// ── Socket.io ───────────────────────────────────────────────────────
io.on('connection', socket => {
  let playerCtx: { code: string; playerId: string } | null = null

  socket.on('player:join', ({ code, nickname, token }: { code: string; nickname: string; token?: string }) => {
    const room = rooms.get(code)
    if (!room) { socket.emit('room:error', { message: '找不到房間' }); return }
    if (room.state !== 'LOBBY' && !token) { socket.emit('room:error', { message: '遊戲已開始' }); return }

    const { room: updated, player } = addPlayer(room, nickname, token, socket.id)
    rooms.set(code, updated)
    playerCtx = { code, playerId: player.id }
    socket.join(code)
    socket.emit('player:token', { token: player.id })
    broadcast(updated)
  })

  socket.on('game:confirm', () => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room || !['LOBBY', 'ROUND_RESULT'].includes(room.state)) {
      socket.emit('room:error', { message: '目前無法確認' }); return
    }
    room = setPlayerConfirmed(room, playerId)
    rooms.set(code, room)
    broadcast(room)

    // LOBBY has no pre-existing timer — start the 60s inactivity timer on first confirm
    // ROUND_RESULT timer is already set inside advanceToRoundResult(), so we don't add another
    if (room.state === 'LOBBY' && !timers.has(code)) {
      setTimer(code, 60_000, () => advanceToWordGeneration(code))
    }

    checkAndAdvance(code)  // if allConfirmed, clears timer and advances immediately
  })

  socket.on('game:submit-answer', ({ text }: { text: string }) => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room || room.state !== 'ANSWER_INPUT') {
      socket.emit('room:error', { message: '目前不是作答階段' }); return
    }
    room = submitAnswer(room, playerId, text)
    rooms.set(code, room)
    broadcast(room)
    checkAndAdvance(code)
  })

  socket.on('game:vote', ({ answerId }: { answerId: string }) => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room || room.state !== 'VOTING') {
      socket.emit('room:error', { message: '目前不是投票階段' }); return
    }
    room = voteForAnswer(room, playerId, answerId)
    rooms.set(code, room)
    broadcast(room)
    checkAndAdvance(code)
  })

  socket.on('disconnect', () => {
    if (!playerCtx) return
    const { code, playerId } = playerCtx
    let room = rooms.get(code)
    if (!room) return
    room = removePlayer(room, playerId)
    if (room.players.length === 0) { cleanupRoom(code); return }
    rooms.set(code, room)
    broadcast(room)
    checkAndAdvance(code)
  })
})

const PORT = process.env.PORT ?? 3001
httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
```

- [ ] **Step 2: Smoke test — server starts without errors**

```bash
cd server && LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=dummy npx tsx index.ts
```

Expected: `Server running on http://localhost:3001`

Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: Express + Socket.io server with full game orchestration"
```

---

## Task 8: Client Project Setup

**Files:**
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `client/src/style.css`
- Create: `client/src/socket.ts`

- [ ] **Step 1: Create client/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '~shared': resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
```

- [ ] **Step 2: Create client/index.html**

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>偽百科詞典</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 3: Create client/src/style.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; }
#app { max-width: 480px; margin: 0 auto; padding: 16px; min-height: 100vh; }
h1 { font-size: 1.5rem; margin-bottom: 16px; }
h2 { font-size: 1.2rem; margin-bottom: 12px; }
button {
  padding: 12px 24px; border: none; border-radius: 8px;
  background: #6c3aed; color: white; font-size: 1rem; cursor: pointer; width: 100%;
  margin-top: 8px;
}
button:disabled { background: #ccc; cursor: default; }
input, textarea {
  width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px;
  font-size: 1rem; margin-top: 8px;
}
.card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
.card.selected { border: 2px solid #6c3aed; }
.timer { font-size: 2rem; font-weight: bold; text-align: center; color: #6c3aed; margin: 12px 0; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
.badge-ai { background: #fef3c7; color: #92400e; }
.badge-guesser { background: #ede9fe; color: #5b21b6; }
.score-delta { color: #16a34a; font-weight: bold; }
```

- [ ] **Step 4: Create client/src/socket.ts**

```typescript
import { io, type Socket } from 'socket.io-client'
import type { PublicRoom } from '~shared/types'

let socket: Socket
let myPlayerId: string | null = localStorage.getItem('playerId')

export function getMyPlayerId(): string | null {
  return myPlayerId
}

export function connect(onUpdate: (room: PublicRoom) => void, onError: (msg: string) => void): void {
  socket = io()
  socket.on('room:state-update', onUpdate)
  socket.on('room:error', ({ message }: { message: string }) => onError(message))
  socket.on('player:token', ({ token }: { token: string }) => {
    myPlayerId = token
    localStorage.setItem('playerId', token)
  })
}

export function joinRoom(code: string, nickname: string): void {
  const token = localStorage.getItem('playerId') ?? undefined
  socket.emit('player:join', { code, nickname, token })
}

export function confirmReady(): void {
  socket.emit('game:confirm')
}

export function submitAnswer(text: string): void {
  socket.emit('game:submit-answer', { text })
}

export function voteForAnswer(answerId: string): void {
  socket.emit('game:vote', { answerId })
}
```

- [ ] **Step 5: Commit**

```bash
git add client/
git commit -m "feat: client project setup with Vite, socket wrapper"
```

---

## Task 9: Home Screen + Screen Router (main.ts)

**Files:**
- Create: `client/src/main.ts`

- [ ] **Step 1: Create client/src/main.ts**

```typescript
import { connect, joinRoom, getMyPlayerId } from './socket'
import { render as renderLobby } from './screens/lobby'
import { render as renderAnswer } from './screens/answer'
import { render as renderVoting } from './screens/voting'
import { render as renderResults } from './screens/results'
import { render as renderGameover } from './screens/gameover'
import type { PublicRoom } from '~shared/types'

const app = document.getElementById('app')!

function showError(msg: string): void {
  const el = document.createElement('p')
  el.style.cssText = 'color:red;margin-top:8px'
  el.textContent = msg
  app.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}

function renderHome(): void {
  app.innerHTML = `
    <h1>偽百科詞典</h1>
    <div class="card">
      <h2>建立房間</h2>
      <select id="pool-select" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-top:8px"></select>
      <input id="host-nickname" placeholder="你的暱稱" maxlength="16" />
      <button id="create-btn">建立房間</button>
    </div>
    <div class="card">
      <h2>加入房間</h2>
      <input id="room-code" placeholder="輸入房號" maxlength="5" style="text-transform:uppercase" />
      <input id="join-nickname" placeholder="你的暱稱" maxlength="16" />
      <button id="join-btn">加入</button>
    </div>
  `

  // Load available pools
  fetch('/api/pools')
    .then(r => r.json())
    .then(({ pools }: { pools: string[] }) => {
      const select = document.getElementById('pool-select') as HTMLSelectElement
      pools.forEach(p => {
        const opt = document.createElement('option')
        opt.value = p
        opt.textContent = p
        select.appendChild(opt)
      })
    })

  document.getElementById('create-btn')!.addEventListener('click', async () => {
    const pool = (document.getElementById('pool-select') as HTMLSelectElement).value
    const nickname = (document.getElementById('host-nickname') as HTMLInputElement).value.trim()
    if (!nickname) { showError('請輸入暱稱'); return }
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionPool: pool }),
    })
    const { code } = await res.json()
    startGame(code, nickname)
  })

  document.getElementById('join-btn')!.addEventListener('click', () => {
    const code = (document.getElementById('room-code') as HTMLInputElement).value.trim().toUpperCase()
    const nickname = (document.getElementById('join-nickname') as HTMLInputElement).value.trim()
    if (!code || !nickname) { showError('請填寫房號和暱稱'); return }
    startGame(code, nickname)
  })
}

function startGame(code: string, nickname: string): void {
  connect(room => renderRoom(room), showError)
  joinRoom(code, nickname)
}

function renderRoom(room: PublicRoom): void {
  const myId = getMyPlayerId()
  switch (room.state) {
    case 'LOBBY': renderLobby(room, myId); break
    case 'WORD_GENERATION':
    case 'ANSWER_INPUT': renderAnswer(room, myId); break
    case 'VOTING': renderVoting(room, myId); break
    case 'ROUND_RESULT': renderResults(room, myId); break
    case 'GAME_OVER': renderGameover(room); break
  }
}

renderHome()
```

- [ ] **Step 2: Commit**

```bash
git add client/src/main.ts
git commit -m "feat: home screen and game screen router"
```

---

## Task 10: Lobby Screen

**Files:**
- Create: `client/src/screens/lobby.ts`

- [ ] **Step 1: Create lobby.ts**

```typescript
import { confirmReady } from '../socket'
import type { PublicRoom } from '~shared/types'

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const confirmedCount = room.players.filter(p => p.hasConfirmed).length
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadyConfirmed = myPlayer?.hasConfirmed ?? false

  app.innerHTML = `
    <h1>偽百科詞典</h1>
    <div class="card">
      <p style="font-size:0.85rem;color:#666">房號</p>
      <p style="font-size:2rem;font-weight:bold;letter-spacing:0.2em">${room.code}</p>
      <p style="font-size:0.85rem;color:#666;margin-top:4px">題庫：${room.questionPool}</p>
    </div>
    <div class="card">
      <h2>玩家（${room.players.length} 人）</h2>
      <ul style="list-style:none">
        ${room.players.map(p => `
          <li style="padding:8px 0;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between">
            <span>${p.nickname}${p.id === room.hostId ? ' 👑' : ''}</span>
            <span>${p.hasConfirmed ? '✅ 準備好了' : '⏳ 等待中'}</span>
          </li>`).join('')}
      </ul>
    </div>
    <p style="text-align:center;color:#666;margin:8px 0">${confirmedCount}/${room.players.length} 人準備好了</p>
    <button id="confirm-btn" ${alreadyConfirmed ? 'disabled' : ''}>
      ${alreadyConfirmed ? '已準備好了 ✅' : '準備好了！'}
    </button>
  `

  if (!alreadyConfirmed) {
    document.getElementById('confirm-btn')!.addEventListener('click', confirmReady)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/screens/lobby.ts
git commit -m "feat: lobby screen"
```

---

## Task 11: Answer Screen

**Files:**
- Create: `client/src/screens/answer.ts`

- [ ] **Step 1: Create answer.ts**

```typescript
import { submitAnswer } from '../socket'
import type { PublicRoom } from '~shared/types'

let timerInterval: ReturnType<typeof setInterval> | null = null

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadySubmitted = myPlayer?.hasSubmitted ?? false
  const submittedCount = room.players.filter(p => p.hasSubmitted).length

  if (room.state === 'WORD_GENERATION') {
    app.innerHTML = `
      <div style="text-align:center;padding:40px 0">
        <p style="font-size:1.2rem;color:#666">正在生成題目…</p>
        <p style="font-size:2rem;margin-top:16px">🎲</p>
      </div>
    `
    return
  }

  // Clear previous timer
  if (timerInterval) clearInterval(timerInterval)

  app.innerHTML = `
    <div class="card">
      <p style="font-size:0.85rem;color:#666">第 ${room.round}/${room.maxRounds} 回合</p>
      <div class="timer" id="countdown">--</div>
      <h2 style="text-align:center;font-size:1.4rem">${room.currentWord}</h2>
    </div>
    <div class="card">
      ${alreadySubmitted
        ? `<p style="text-align:center;color:#16a34a">✅ 已送出！等待其他玩家…<br><small>${submittedCount}/${room.players.length} 人完成</small></p>`
        : `<textarea id="answer-input" placeholder="幫這個詞彙瞎掰一個假定義…" rows="4" maxlength="200"></textarea>
           <button id="submit-btn">送出答案</button>`
      }
    </div>
  `

  // Countdown timer
  function tick() {
    const secsLeft = Math.max(0, Math.ceil((room.timerEndsAt - Date.now()) / 1000))
    const el = document.getElementById('countdown')
    if (el) el.textContent = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}`
  }
  tick()
  timerInterval = setInterval(tick, 500)

  if (!alreadySubmitted) {
    document.getElementById('submit-btn')!.addEventListener('click', () => {
      const text = (document.getElementById('answer-input') as HTMLTextAreaElement).value.trim()
      if (!text) return
      submitAnswer(text)
    })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/screens/answer.ts
git commit -m "feat: answer input screen with countdown timer"
```

---

## Task 12: Voting Screen

**Files:**
- Create: `client/src/screens/voting.ts`

- [ ] **Step 1: Create voting.ts**

```typescript
import { voteForAnswer } from '../socket'
import type { PublicRoom } from '~shared/types'

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadyVoted = myPlayer?.hasVoted ?? false
  const votedCount = room.players.filter(p => p.hasVoted).length

  app.innerHTML = `
    <div class="card">
      <p style="font-size:0.85rem;color:#666">投票階段・第 ${room.round}/${room.maxRounds} 回合</p>
      <h2>${room.currentWord}</h2>
      <p style="margin-top:8px;color:#666;font-size:0.9rem">哪一則是 AI 寫的？</p>
    </div>
    ${alreadyVoted
      ? `<div class="card" style="text-align:center;color:#16a34a">✅ 已投票！等待其他玩家…<br><small>${votedCount}/${room.players.length} 人完成</small></div>`
      : ''
    }
    ${room.answers.map((a, i) => `
      <div class="card answer-card" data-id="${a.id}" style="cursor:${alreadyVoted ? 'default' : 'pointer'}">
        <span style="color:#6c3aed;font-weight:bold">${String.fromCharCode(65 + i)}.</span>
        ${a.text}
      </div>`).join('')}
  `

  if (!alreadyVoted) {
    app.querySelectorAll('.answer-card').forEach(card => {
      card.addEventListener('click', () => {
        const answerId = (card as HTMLElement).dataset.id!
        // Highlight selection
        app.querySelectorAll('.answer-card').forEach(c => c.classList.remove('selected'))
        card.classList.add('selected')
        voteForAnswer(answerId)
      })
    })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/screens/voting.ts
git commit -m "feat: voting screen"
```

---

## Task 13: Results Screen

**Files:**
- Create: `client/src/screens/results.ts`

- [ ] **Step 1: Create results.ts**

```typescript
import { confirmReady } from '../socket'
import type { PublicRoom } from '~shared/types'

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadyConfirmed = myPlayer?.hasConfirmed ?? false
  const confirmedCount = room.players.filter(p => p.hasConfirmed).length

  const playerMap = Object.fromEntries(room.players.map(p => [p.id, p.nickname]))

  const answersHtml = room.answers.map((a, i) => {
    const isAI = a.authorId === 'AI'
    const isAIGuess = room.aiGuesserVote === a.id
    const authorLabel = isAI
      ? '<span class="badge badge-ai">🤖 AI</span>'
      : `<strong>${playerMap[a.authorId!] ?? '?'}</strong>`
    const guesserLabel = isAIGuess
      ? '<span class="badge badge-guesser">🤖 猜題 AI 也選了這個</span>'
      : ''
    const votesLabel = a.votes.length > 0
      ? `<div style="font-size:0.8rem;color:#666;margin-top:4px">投票者：${a.votes.map(id => playerMap[id] ?? '?').join('、')}</div>`
      : '<div style="font-size:0.8rem;color:#bbb;margin-top:4px">無人投票</div>'
    return `
      <div class="card" style="${isAI ? 'border:2px solid #f59e0b' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <span style="color:#6c3aed;font-weight:bold">${String.fromCharCode(65 + i)}.</span>
          <div>${authorLabel} ${guesserLabel}</div>
        </div>
        <p style="margin-top:8px">${a.text}</p>
        ${votesLabel}
      </div>`
  }).join('')

  const sortedPlayers = [...room.players].sort((a, b) => (room.scores[b.id] ?? 0) - (room.scores[a.id] ?? 0))
  const scoreboardHtml = sortedPlayers.map((p, i) => `
    <li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0">
      <span>${i === 0 ? '🏆 ' : ''}${p.nickname}${p.id === myId ? ' (你)' : ''}</span>
      <span style="font-weight:bold">${room.scores[p.id] ?? 0} 分</span>
    </li>`).join('')

  const aiGuessNote = room.aiGuesserVote === 'TIMEOUT'
    ? '<p style="color:#9ca3af;font-size:0.85rem">猜題 AI 未能在時限內作答</p>'
    : room.aiGuesserVote
      ? ''
      : ''

  app.innerHTML = `
    <h1>回合結果</h1>
    ${aiGuessNote}
    ${answersHtml}
    <div class="card">
      <h2>計分板</h2>
      <ul style="list-style:none">${scoreboardHtml}</ul>
    </div>
    <p style="text-align:center;color:#666;margin:8px 0">${confirmedCount}/${room.players.length} 人準備繼續</p>
    <button id="continue-btn" ${alreadyConfirmed ? 'disabled' : ''}>
      ${alreadyConfirmed ? '等待其他玩家…' : '繼續 →'}
    </button>
  `

  if (!alreadyConfirmed) {
    document.getElementById('continue-btn')!.addEventListener('click', confirmReady)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/screens/results.ts
git commit -m "feat: results screen with author reveal and AI guesser comparison"
```

---

## Task 14: Game Over Screen

**Files:**
- Create: `client/src/screens/gameover.ts`

- [ ] **Step 1: Create gameover.ts**

```typescript
import type { PublicRoom } from '~shared/types'

export function render(room: PublicRoom): void {
  const app = document.getElementById('app')!

  const sorted = [...room.players].sort((a, b) => (room.scores[b.id] ?? 0) - (room.scores[a.id] ?? 0))
  const mvp = sorted[0]

  const rankHtml = sorted.map((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`
    return `
      <li style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f0f0f0">
        <span style="font-size:1.2rem">${medal}</span>
        <span style="flex:1;margin:0 12px;font-weight:${i === 0 ? 'bold' : 'normal'}">${p.nickname}</span>
        <span style="font-weight:bold">${room.scores[p.id] ?? 0} 分</span>
      </li>`
  }).join('')

  app.innerHTML = `
    <h1 style="text-align:center">遊戲結束！</h1>
    <div class="card" style="text-align:center;background:#fef9c3;border:2px solid #f59e0b">
      <p style="font-size:0.9rem;color:#92400e">本局 MVP</p>
      <p style="font-size:2rem;font-weight:bold;margin:8px 0">🏆 ${mvp?.nickname ?? '—'}</p>
      <p style="font-size:1.2rem;color:#92400e">${room.scores[mvp?.id ?? ''] ?? 0} 分</p>
    </div>
    <div class="card">
      <h2>最終排行</h2>
      <ul style="list-style:none">${rankHtml}</ul>
    </div>
    <button onclick="location.reload()">再玩一局</button>
  `
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/screens/gameover.ts
git commit -m "feat: game over screen with leaderboard and MVP"
```

---

## Task 15: Config Files

**Files:**
- Create: `.env.example`
- Create: `server/data/pools/storytelling.json`

- [ ] **Step 1: Create .env.example**

```env
# LLM Provider: anthropic | openai | ollama
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (if LLM_PROVIDER=openai)
OPENAI_API_KEY=sk-...

# Ollama local (if LLM_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434

# Server port (default: 3001)
PORT=3001
```

- [ ] **Step 2: Create server/data/pools/storytelling.json**

```json
[
  { "word": "龍捲風敘事法", "fallback": "一種說故事的技巧，在故事開始時先描述結局，再以螺旋方式向前回溯，直到回到故事起點才揭示原因。" },
  { "word": "時間折疊理論", "fallback": "物理學家羅伯特・傅爾斯坦 1987 年提出的假說，認為強烈的情感記憶能在時間維度上留下可測量的壓痕。" },
  { "word": "反向蝴蝶效應", "fallback": "指某件微小事件反常地造成更小、更局限的連鎖反應，與傳統混沌理論相悖，目前仍具爭議。" }
]
```

- [ ] **Step 3: Add .gitignore**

```
node_modules/
.env
dist/
```

- [ ] **Step 4: Commit**

```bash
git add .env.example server/data/pools/storytelling.json .gitignore
git commit -m "chore: add config files and storytelling word pool"
```

---

## Task 16: End-to-End Smoke Test

- [ ] **Step 1: Copy .env.example to .env and fill in your API key**

```bash
cp .env.example .env
# Edit .env and set your ANTHROPIC_API_KEY (or use ollama with no key)
```

- [ ] **Step 2: Start server and client**

```bash
npm run dev
```

Expected: Server on http://localhost:3001, client on http://localhost:5173

- [ ] **Step 3: Open two browser tabs to http://localhost:5173**

Tab A: Create a room (choose a pool, enter a nickname), note the room code.
Tab B: Join with the room code and a different nickname.

Expected: Both tabs show the lobby with both players listed.

- [ ] **Step 4: Verify lobby confirm flow**

Both tabs: click "準備好了". Expected: game advances to ANSWER_INPUT with the word displayed and a 60s timer.

- [ ] **Step 5: Verify answer input**

Both tabs: type a fake definition and click "送出答案". Expected: after both submit, game advances to VOTING with shuffled anonymous answers.

- [ ] **Step 6: Verify voting**

Tab A: click one of the answers. Expected: Tab A shows "已投票". After Tab B votes, game advances to ROUND_RESULT.

- [ ] **Step 7: Verify results screen**

Expected:
- All answers shown with authors revealed
- AI answer highlighted with 🤖 badge
- AI guesser's pick shown with purple badge (or "AI 未能作答" if it timed out)
- Scores updated correctly
- "繼續" button visible on both tabs

- [ ] **Step 8: Play 5 rounds and verify GAME_OVER**

Expected: After round 5, GAME_OVER screen shows leaderboard with 🏆 MVP highlighted.

- [ ] **Step 9: Verify reconnect**

During ANSWER_INPUT, close Tab A and reopen http://localhost:5173. Enter the same room code + same nickname. Expected: Tab A rejoins the room in the current state.
