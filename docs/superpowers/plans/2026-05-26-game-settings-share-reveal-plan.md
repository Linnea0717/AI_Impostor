# Game Settings / Share Link / Correct-Answer Reveal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four 偽百科詞典 features — 4-digit numeric room codes, lobby share link + QR, host-configurable game settings (answer/voting time, end condition), and per-round correct-answer reveal.

**Architecture:** Server stores per-room `GameSettings` (ms internally, but seconds at API/UI boundary). Phase timers and AI timeouts derive from `room.settings`. `currentWordCorrect` carried on the room, gated to `ROUND_RESULT` in `toPublicRoom`. Client gets advanced-settings form on home screen and a share UI on lobby.

**Tech Stack:** TypeScript, Node.js, Express, Socket.io, Vitest, Vite, vanilla TS client, `qrcode` (new client dep).

**Spec:** `docs/superpowers/specs/2026-05-26-game-settings-share-reveal-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `shared/config.ts` | create | `SETTINGS_BOUNDS`, `ROOM_CODE_LENGTH`, `SCORE_MODE_SAFETY_CAP` |
| `shared/types.ts` | modify | `GameSettings` interface; `Room.settings`, `Room.currentWordCorrect`; drop `maxRounds` |
| `server/game/room.ts` | modify | `generateCode` → 4 digits; `createRoom(pool, name, settings)`; `toPublicRoom` gates `currentWordCorrect` |
| `server/game/__tests__/room.test.ts` | modify | All `createRoom` calls take settings; new 4-digit + correctWord tests |
| `server/__tests__/settings-parsing.test.ts` | create | Unit tests for `parseSettings` |
| `server/index.ts` | modify | `parseSettings`, per-room timers, AI timeouts relative, set `currentWordCorrect` on word pick, end-condition logic, 120 s constants |
| `client/package.json` | modify | Add `qrcode` + `@types/qrcode` |
| `client/src/utils/progress.ts` | create | `formatProgress(room)` helper |
| `client/src/main.ts` | modify | Advanced-settings form, URL `?room=` prefill, send settings in POST body |
| `client/src/screens/lobby.ts` | modify | Share link + QR card |
| `client/src/screens/answer.ts` | modify | Replace `maxRounds` with `formatProgress` |
| `client/src/screens/results.ts` | modify | Correct-answer card; `formatProgress` |

Tests are run from the project root with `npm test` (forwards to server workspace `vitest run`).

---

## Task 1: Add shared config module

**Files:**
- Create: `shared/config.ts`

- [ ] **Step 1: Create the file**

```ts
// shared/config.ts
export const SETTINGS_BOUNDS = {
  answerInputSec: { min: 30, max: 180, default: 90 },
  votingSec:      { min: 20, max: 90,  default: 45 },
  rounds:         { min: 3,  max: 10,  default: 5 },
  score:          { min: 5,  max: 30,  default: 15 },
} as const

export const ROOM_CODE_LENGTH = 4
export const SCORE_MODE_SAFETY_CAP = 30
```

- [ ] **Step 2: Type-check compiles**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: no errors (file isn't imported yet, but it should still parse).

- [ ] **Step 3: Commit**

```bash
git add shared/config.ts
git commit -m "feat(shared): add SETTINGS_BOUNDS / ROOM_CODE_LENGTH / SCORE_MODE_SAFETY_CAP"
```

---

## Task 2: Extend shared types with GameSettings and currentWordCorrect

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Add the new interface and fields**

Replace the contents of `shared/types.ts` with:

```ts
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
```

- [ ] **Step 2: Type-check the project (it will fail in places that still reference `maxRounds`)**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: errors complaining about `maxRounds` in `server/game/room.ts`, `server/index.ts` and `room.test.ts`. That's the next tasks' job to fix.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat(shared): add GameSettings; replace maxRounds with settings + currentWordCorrect"
```

---

## Task 3: 4-digit numeric room code (TDD)

**Files:**
- Modify: `server/game/__tests__/room.test.ts`
- Modify: `server/game/room.ts`

- [ ] **Step 1: Add the failing test**

At the top of `server/game/__tests__/room.test.ts`, add an import that doesn't exist yet:

```ts
import type { GameSettings } from '~shared/types'

function makeTestSettings(): GameSettings {
  return {
    answerInputMs: 90_000,
    votingMs: 45_000,
    endCondition: { type: 'rounds', value: 5 },
  }
}
```

Then add a new test in the existing `describe('createRoom', ...)` block:

```ts
  it('generates a 4-digit numeric room code', () => {
    const room = createRoom('rare', '罕見詞', makeTestSettings())
    expect(room.code).toMatch(/^[0-9]{4}$/)
  })
```

(The other tests still pass `'rare', '罕見詞'` without settings — they'll be fixed in Task 4 — so this single test is the only one that should compile against the new signature yet. To keep the file compiling for now, also pass `makeTestSettings()` as the third argument to every existing `createRoom(...)` call in this file via search-and-replace. Use:

```bash
sed -i "s/createRoom('rare', '罕見詞')/createRoom('rare', '罕見詞', makeTestSettings())/g" server/game/__tests__/room.test.ts
```

After the sed, also delete the line `expect(room.maxRounds).toBe(5)` from the first test — it's no longer a field. Replace it with:

```ts
    expect(room.settings.endCondition).toEqual({ type: 'rounds', value: 5 })
```

Also update the old code-shape assertion in that same test from:

```ts
    expect(room.code).toMatch(/^[A-Z0-9]{5}$/)
```

to:

```ts
    expect(room.code).toMatch(/^[0-9]{4}$/)
```

so the old assertion isn't fighting the new one.)

- [ ] **Step 2: Run the test — it should fail**

Run: `npm test --workspace=server`
Expected: TypeScript errors about `createRoom` not accepting 3 args, OR tests fail because `room.code` is still 5 chars. Either failure is fine.

- [ ] **Step 3: Implement `generateCode` and update `createRoom` signature**

Edit `server/game/room.ts`. Replace the top of the file through `createRoom` with:

```ts
import { randomUUID } from 'crypto'
import type { Room, Player, Answer, GameSettings, PublicRoom } from '~shared/types'
import type { ScoreDeltas } from './scoring'

function generateCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

export function createRoom(
  questionPool: string,
  questionPoolName: string,
  settings: GameSettings,
): Room {
  return {
    code: generateCode(),
    hostId: '',
    questionPool,
    questionPoolName,
    players: [],
    state: 'LOBBY',
    round: 0,
    settings,
    currentWord: '',
    currentWordCorrect: '',
    answers: [],
    aiGuesserVote: null,
    aiGuesserVoted: false,
    aiSubmitted: false,
    scores: {},
    timerEndsAt: 0,
  }
}
```

Remove the old `CODE_CHARS` constant and the old 5-char `generateCode`.

- [ ] **Step 4: Run the room tests — they should pass**

Run: `npm test --workspace=server -- room`
Expected: all room.test.ts tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/game/room.ts server/game/__tests__/room.test.ts
git commit -m "feat(server): 4-digit numeric room code; createRoom takes GameSettings"
```

---

## Task 4: `toPublicRoom` gates `currentWordCorrect` (TDD)

**Files:**
- Modify: `server/game/__tests__/room.test.ts`
- Modify: `server/game/room.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/game/__tests__/room.test.ts`, inside the existing `describe('toPublicRoom', …)` block:

```ts
  it('hides currentWordCorrect outside ROUND_RESULT', () => {
    const base = createRoom('rare', '罕見詞', makeTestSettings())
    const r = { ...base, state: 'ANSWER_INPUT' as const, currentWordCorrect: '真實解答' }
    const pub = toPublicRoom(r)
    expect(pub.currentWordCorrect).toBe('')
  })

  it('reveals currentWordCorrect during ROUND_RESULT', () => {
    const base = createRoom('rare', '罕見詞', makeTestSettings())
    const r = { ...base, state: 'ROUND_RESULT' as const, currentWordCorrect: '真實解答' }
    const pub = toPublicRoom(r)
    expect(pub.currentWordCorrect).toBe('真實解答')
  })
```

- [ ] **Step 2: Run — both new tests fail**

Run: `npm test --workspace=server -- room`
Expected: the two new tests fail because `toPublicRoom` doesn't touch `currentWordCorrect` yet.

- [ ] **Step 3: Implement the gate in `toPublicRoom`**

Edit `server/game/room.ts` `toPublicRoom`:

```ts
export function toPublicRoom(room: Room): PublicRoom {
  const hideAuthors = room.state === 'VOTING'
  const revealCorrect = room.state === 'ROUND_RESULT'
  return {
    ...room,
    answers: room.answers.map(({ authorId, ...rest }) => ({
      ...rest,
      ...(hideAuthors ? {} : { authorId }),
    })),
    aiGuesserVote: hideAuthors ? null : room.aiGuesserVote,
    currentWordCorrect: revealCorrect ? room.currentWordCorrect : '',
  }
}
```

- [ ] **Step 4: Run — tests pass**

Run: `npm test --workspace=server -- room`
Expected: all room tests green.

- [ ] **Step 5: Commit**

```bash
git add server/game/room.ts server/game/__tests__/room.test.ts
git commit -m "feat(server): toPublicRoom reveals currentWordCorrect only in ROUND_RESULT"
```

---

## Task 5: `parseSettings` helper (TDD)

**Files:**
- Create: `server/__tests__/settings-parsing.test.ts`
- Modify: `server/index.ts` (extract helper)

**Note:** We will extract `parseSettings` into its own file in this task so it can be unit-tested without spinning up Express. Create `server/settings.ts` for the helper, then import it from `server/index.ts` in Task 6.

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/settings-parsing.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — fails (module not found)**

Run: `npm test --workspace=server -- settings-parsing`
Expected: fails to import `../settings`.

- [ ] **Step 3: Implement `server/settings.ts`**

Create `server/settings.ts`:

```ts
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
```

- [ ] **Step 4: Run — green**

Run: `npm test --workspace=server -- settings-parsing`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/settings.ts server/__tests__/settings-parsing.test.ts
git commit -m "feat(server): add parseSettings with bounds validation and sec→ms conversion"
```

---

## Task 6: Wire settings into `POST /api/rooms` and bump collision retries

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Update the route**

In `server/index.ts`, find the existing `app.post('/api/rooms', …)` handler and replace it with:

```ts
app.post('/api/rooms', (req, res) => {
  const body = req.body as {
    questionPool?: string
    answerInputSec?: number
    votingSec?: number
    endCondition?: { type: string; value: number }
  }

  const pools = listPools()
  const poolMeta = pools.find(p => p.id === body.questionPool)
  if (!poolMeta) {
    res.status(400).json({ error: 'invalid_question_pool' })
    return
  }

  const parsed = parseSettings(body)
  if (!parsed.ok) {
    res.status(400).json({
      error: 'settings_out_of_range',
      field: parsed.field,
      min: parsed.min,
      max: parsed.max,
    })
    return
  }

  let room = createRoom(poolMeta.id, poolMeta.name, parsed.value)
  let attempts = 0
  while (rooms.has(room.code) && attempts < 50) {
    room = createRoom(poolMeta.id, poolMeta.name, parsed.value)
    attempts++
  }
  if (rooms.has(room.code)) {
    res.status(500).json({ error: 'Failed to generate unique room code' })
    return
  }

  rooms.set(room.code, room)
  wordPools.set(room.code, loadPool(poolMeta.id))
  usedWords.set(room.code, new Set())
  res.json({ code: room.code })
})
```

Add at the top of `server/index.ts` near the other imports:

```ts
import { parseSettings } from './settings'
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p server/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Run existing tests to confirm nothing else broke**

Run: `npm test --workspace=server`
Expected: all tests green (server tests don't exercise this route, so this is a sanity check).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): validate settings and bump room-code collision retries to 50"
```

---

## Task 7: Use per-room settings in phase timers and AI timeouts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Update phase-duration constants**

Near the top of `server/index.ts`, find the block that defines `LOBBY_CONFIRM_MS`, `ANSWER_INPUT_MS`, `VOTING_MS`, `ROUND_RESULT_MS`, `AI_DEFINITION_TIMEOUT_MS`, `AI_GUESSER_TIMEOUT_MS`. Replace it with:

```ts
// ── Phase durations (ms) ─────────────────────────────────────────────
const LOBBY_CONFIRM_MS = 120_000          // lobby idle timeout after first confirm
const ROUND_RESULT_MS = 120_000           // result/correct-answer display between rounds
// Answer-input + voting durations are per-room (room.settings).
// AI sub-timeouts derive from those (settings.*Ms - 2_000), see below.
```

- [ ] **Step 2: Update `advanceToWordGeneration` to use settings**

Find `advanceToWordGeneration` and replace its body. The relevant lines that need updating:

- Replace `Date.now() + ANSWER_INPUT_MS` with `Date.now() + room.settings.answerInputMs`
- Replace `setTimer(code, ANSWER_INPUT_MS, …)` with `setTimer(code, room.settings.answerInputMs, …)`
- Replace `withTimeout(generateDefinition(entry.word), AI_DEFINITION_TIMEOUT_MS)` with `withTimeout(generateDefinition(entry.word), room.settings.answerInputMs - 2_000)`

After the changes, the function body should be:

```ts
function advanceToWordGeneration(code: string) {
  let room = rooms.get(code)
  if (!room || !['LOBBY', 'ROUND_RESULT'].includes(room.state)) return

  room = resetPerRound(room)
  room = { ...room, state: 'WORD_GENERATION', round: room.round + 1 }
  rooms.set(code, room)
  broadcast(room)

  const pool = wordPools.get(code)!
  const used = usedWords.get(code)!
  const entry = pickWord(pool, used)
  used.add(entry.word)

  room = {
    ...room,
    state: 'ANSWER_INPUT',
    currentWord: entry.word,
    currentWordCorrect: entry.fallback,
    timerEndsAt: Date.now() + room.settings.answerInputMs,
    aiSubmitted: false,
  }
  rooms.set(code, room)
  broadcast(room)

  setTimer(code, room.settings.answerInputMs, () => advanceToVoting(code))

  withTimeout(generateDefinition(entry.word), room.settings.answerInputMs - 2_000)
    .then(definition => { pendingAiDefinitions.set(code, definition) })
    .catch(err => {
      console.error('[AI imposter] failed, using fallback:', err instanceof Error ? err.message : err)
      pendingAiDefinitions.set(code, entry.fallback)
    })
    .finally(() => {
      const r = rooms.get(code)
      if (!r || r.state !== 'ANSWER_INPUT') return
      rooms.set(code, { ...r, aiSubmitted: true })
      broadcast(rooms.get(code)!)
      checkAndAdvance(code)
    })
}
```

- [ ] **Step 3: Update `advanceToVoting` to use settings**

Replace the function:

```ts
async function advanceToVoting(code: string) {
  clearTimer(code)
  let room = rooms.get(code)
  if (!room || room.state !== 'ANSWER_INPUT') return

  const aiText = pendingAiDefinitions.get(code) ?? '（AI 備援定義）'
  pendingAiDefinitions.delete(code)
  const aiAnswer: Answer = { id: randomUUID(), text: aiText, authorId: 'AI', votes: [] }

  room = prepareVoting(room, aiAnswer)
  room = { ...room, timerEndsAt: Date.now() + room.settings.votingMs }
  rooms.set(code, room)
  broadcast(room)

  const answersForGuesser = room.answers.map(a => ({ id: a.id, text: a.text }))
  let aiGuesserVoteResult: string = 'TIMEOUT'
  withTimeout(guessDefinition(answersForGuesser), room.settings.votingMs - 2_000)
    .then(answerId => { aiGuesserVoteResult = answerId })
    .catch(err => console.error('[AI guesser] failed:', err instanceof Error ? err.message : err))
    .finally(() => {
      const r = rooms.get(code)
      if (!r || (r.state !== 'VOTING' && r.state !== 'ROUND_RESULT')) return
      rooms.set(code, { ...r, aiGuesserVote: aiGuesserVoteResult, aiGuesserVoted: true })
      broadcast(rooms.get(code)!)
      if (r.state === 'VOTING') checkAndAdvance(code)
    })

  setTimer(code, room.settings.votingMs, () => advanceToRoundResult(code))
}
```

- [ ] **Step 4: Type-check + run tests**

Run: `npx tsc --noEmit -p server/tsconfig.json && npm test --workspace=server`
Expected: no type errors; all room tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): per-room timers; 120s lobby+result; AI timeouts relative"
```

---

## Task 8: End-condition logic in `advanceFromRoundResult`

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Replace `advanceFromRoundResult`**

In `server/index.ts`, find the existing `advanceFromRoundResult` and replace it with:

```ts
function advanceFromRoundResult(code: string) {
  const room = rooms.get(code)
  if (!room || room.state !== 'ROUND_RESULT') return

  const { endCondition } = room.settings
  let reached = false
  if (endCondition.type === 'rounds') {
    reached = room.round >= endCondition.value
  } else {
    const maxScore = Math.max(0, ...Object.values(room.scores))
    reached = maxScore >= endCondition.value || room.round >= SCORE_MODE_SAFETY_CAP
  }

  if (reached) advanceToGameOver(code)
  else advanceToWordGeneration(code)
}
```

Add the import near the top of `server/index.ts`:

```ts
import { SCORE_MODE_SAFETY_CAP } from '~shared/config'
```

- [ ] **Step 2: Type-check + tests**

Run: `npx tsc --noEmit -p server/tsconfig.json && npm test --workspace=server`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): end-condition logic (rounds or target score) with safety cap"
```

---

## Task 9: Server smoke test (manual, no commit)

**Files:** none

This is a manual sanity check that the server still starts and accepts settings via the API. Not a code change.

- [ ] **Step 1: Start the server (with whatever LLM provider you've been using)**

Run: `npm run dev --workspace=server`
Expected: console prints `Server running on http://localhost:3001`.

- [ ] **Step 2: Hit the pools endpoint**

Run: `curl -s http://localhost:3001/api/pools | python3 -m json.tool`
Expected: JSON with `pools` array containing at least `classroom` and `uncommon`.

- [ ] **Step 3: Create a room with custom settings**

Run:

```bash
curl -s -X POST http://localhost:3001/api/rooms \
  -H 'Content-Type: application/json' \
  -d '{"questionPool":"classroom","answerInputSec":60,"votingSec":30,"endCondition":{"type":"score","value":10}}' \
  | python3 -m json.tool
```

Expected: `{ "code": "<4-digit string>" }`.

- [ ] **Step 4: Hit with out-of-range setting — should 400**

Run:

```bash
curl -s -X POST http://localhost:3001/api/rooms \
  -H 'Content-Type: application/json' \
  -d '{"questionPool":"classroom","answerInputSec":10}' \
  | python3 -m json.tool
```

Expected: `{ "error": "settings_out_of_range", "field": "answerInputSec", "min": 30, "max": 180 }`.

- [ ] **Step 5: Stop the server**

`Ctrl-C` in the dev terminal.

---

## Task 10: Install `qrcode` client dependency

**Files:**
- Modify: `client/package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run:
```bash
npm install qrcode --workspace=client
npm install -D @types/qrcode --workspace=client
```

- [ ] **Step 2: Confirm versions and check no audit issues**

Run: `npm ls qrcode --workspace=client`
Expected: prints a version, e.g. `qrcode@1.5.x`.

- [ ] **Step 3: Commit**

```bash
git add client/package.json package-lock.json
git commit -m "chore(client): add qrcode + @types/qrcode"
```

---

## Task 11: Client `formatProgress` helper

**Files:**
- Create: `client/src/utils/progress.ts`

- [ ] **Step 1: Create the helper**

```ts
// client/src/utils/progress.ts
import type { PublicRoom } from '~shared/types'

export function formatProgress(room: PublicRoom): string {
  const ec = room.settings.endCondition
  if (ec.type === 'rounds') {
    return `第 ${room.round}/${ec.value} 回合`
  }
  return `第 ${room.round} 回合｜目標 ${ec.value} 分`
}
```

- [ ] **Step 2: Type-check the client**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/progress.ts
git commit -m "feat(client): formatProgress helper"
```

---

## Task 12: Home screen — advanced settings form + URL `?room=` prefill

**Files:**
- Modify: `client/src/main.ts`

- [ ] **Step 1: Replace `renderHome` body**

Replace the contents of `renderHome()` in `client/src/main.ts` with:

```ts
function renderHome(): void {
  const prefillRoom = new URLSearchParams(location.search).get('room') ?? ''

  app.innerHTML = `
    <h1>偽百科詞典</h1>
    <div class="card">
      <h2>建立房間</h2>
      <select id="pool-select" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:1rem;margin-top:8px"></select>
      <input id="host-nickname" placeholder="你的暱稱" maxlength="16" />
      <details style="margin-top:12px">
        <summary style="cursor:pointer;color:#6c3aed">▸ 進階設定</summary>
        <div style="margin-top:12px;display:grid;gap:12px">
          <label>作答時間（秒，30–180）
            <input id="set-answer-sec" type="number" min="30" max="180" step="5" value="90" />
          </label>
          <label>投票時間（秒，20–90）
            <input id="set-voting-sec" type="number" min="20" max="90" step="5" value="45" />
          </label>
          <fieldset style="border:1px solid #eee;border-radius:8px;padding:8px">
            <legend>結束條件</legend>
            <label><input type="radio" name="end-type" value="rounds" checked /> 固定回合數（3–10）</label>
            <input id="set-rounds" type="number" min="3" max="10" step="1" value="5" />
            <br/>
            <label><input type="radio" name="end-type" value="score" /> 達到目標分數（5–30）</label>
            <input id="set-score" type="number" min="5" max="30" step="1" value="15" disabled />
          </fieldset>
        </div>
      </details>
      <button id="create-btn">建立房間</button>
    </div>
    <div class="card">
      <h2>加入房間</h2>
      <input id="room-code" placeholder="輸入房號" maxlength="4" inputmode="numeric" pattern="[0-9]*" value="${prefillRoom}" />
      <input id="join-nickname" placeholder="你的暱稱" maxlength="16" />
      <button id="join-btn">加入</button>
    </div>
  `

  fetch('/api/pools')
    .then(r => r.json())
    .then(({ pools }: { pools: { id: string; name: string }[] }) => {
      const select = document.getElementById('pool-select') as HTMLSelectElement
      pools.forEach(p => {
        const opt = document.createElement('option')
        opt.value = p.id
        opt.textContent = p.name
        select.appendChild(opt)
      })
    })
    .catch(() => showError('無法載入題庫列表'))

  // Toggle the disabled state of the two number inputs when radio changes
  document.querySelectorAll<HTMLInputElement>('input[name="end-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isRounds = (document.querySelector('input[name="end-type"]:checked') as HTMLInputElement).value === 'rounds'
      ;(document.getElementById('set-rounds') as HTMLInputElement).disabled = !isRounds
      ;(document.getElementById('set-score') as HTMLInputElement).disabled = isRounds
    })
  })

  document.getElementById('create-btn')!.addEventListener('click', async () => {
    const pool = (document.getElementById('pool-select') as HTMLSelectElement).value
    const nickname = (document.getElementById('host-nickname') as HTMLInputElement).value.trim()
    if (!nickname) { showError('請輸入暱稱'); return }

    const answerInputSec = Number((document.getElementById('set-answer-sec') as HTMLInputElement).value)
    const votingSec = Number((document.getElementById('set-voting-sec') as HTMLInputElement).value)
    const endType = (document.querySelector('input[name="end-type"]:checked') as HTMLInputElement).value
    const endValue = endType === 'rounds'
      ? Number((document.getElementById('set-rounds') as HTMLInputElement).value)
      : Number((document.getElementById('set-score') as HTMLInputElement).value)

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionPool: pool,
          answerInputSec,
          votingSec,
          endCondition: { type: endType, value: endValue },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; field?: string }
        showError(err.error === 'settings_out_of_range' ? `設定超出範圍：${err.field}` : '建立房間失敗')
        return
      }
      const { code } = await res.json()
      startGame(code, nickname)
    } catch {
      showError('建立房間失敗，請重試')
    }
  })

  document.getElementById('join-btn')!.addEventListener('click', () => {
    const code = (document.getElementById('room-code') as HTMLInputElement).value.trim()
    const nickname = (document.getElementById('join-nickname') as HTMLInputElement).value.trim()
    if (!code || !nickname) { showError('請填寫房號和暱稱'); return }
    startGame(code, nickname)
  })
}
```

Note: room-code input now has `inputmode="numeric"` and `maxlength="4"`; the previous `text-transform:uppercase` is removed since codes are numeric only. The input no longer needs `.toUpperCase()`.

- [ ] **Step 2: Type-check + dev build**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/main.ts
git commit -m "feat(client): advanced settings form + URL ?room= prefill on home screen"
```

---

## Task 13: Lobby — share link + QR code

**Files:**
- Modify: `client/src/screens/lobby.ts`

- [ ] **Step 1: Replace the lobby render**

Replace `client/src/screens/lobby.ts` with:

```ts
import { confirmReady } from '../socket'
import type { PublicRoom } from '~shared/types'
import { escapeHtml } from '../utils'
import { formatProgress } from '../utils/progress'
import QRCode from 'qrcode'

let lastQrCode = ''

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const confirmedCount = room.players.filter(p => p.hasConfirmed).length
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadyConfirmed = myPlayer?.hasConfirmed ?? false

  const shareUrl = `${window.location.origin}/?room=${room.code}`

  app.innerHTML = `
    <h1>偽百科詞典</h1>
    <div class="card">
      <p style="font-size:0.85rem;color:#666">房號</p>
      <p style="font-size:2rem;font-weight:bold;letter-spacing:0.2em">${escapeHtml(room.code)}</p>
      <p style="font-size:0.85rem;color:#666;margin-top:4px">題庫：${escapeHtml(room.questionPoolName)}</p>
      <p style="font-size:0.85rem;color:#666">${escapeHtml(formatProgress(room))}</p>
    </div>
    <div class="card">
      <p style="font-size:0.85rem;color:#666;margin-bottom:6px">分享連結</p>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="share-url" readonly value="${escapeHtml(shareUrl)}" style="flex:1;font-size:0.85rem" />
        <button id="copy-btn" style="width:auto;padding:8px 12px">複製</button>
      </div>
      <div style="margin-top:12px;text-align:center"><img id="qr-img" alt="QR" style="width:160px;height:160px" /></div>
    </div>
    <div class="card">
      <h2>玩家（${room.players.length} 人）</h2>
      <ul style="list-style:none">
        ${room.players.map(p => `
          <li style="padding:8px 0;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between">
            <span>${escapeHtml(p.nickname)}${p.id === room.hostId ? ' 👑' : ''}</span>
            <span>${p.hasConfirmed ? '✅ 準備好了' : '⏳ 等待中'}</span>
          </li>`).join('')}
      </ul>
    </div>
    <p style="text-align:center;color:#666;margin:8px 0">${confirmedCount}/${room.players.length} 人準備好了</p>
    <button id="confirm-btn" ${alreadyConfirmed ? 'disabled' : ''}>
      ${alreadyConfirmed ? '已準備好了 ✅' : '準備好了！'}
    </button>
  `

  // Render QR — once per unique room code, since the whole lobby DOM is
  // rebuilt on every broadcast and re-encoding is wasteful.
  if (lastQrCode !== room.code) {
    lastQrCode = room.code
  }
  QRCode.toDataURL(shareUrl, { width: 160, margin: 1 })
    .then(dataUrl => {
      const img = document.getElementById('qr-img') as HTMLImageElement | null
      if (img) img.src = dataUrl
    })
    .catch(() => { /* swallow */ })

  document.getElementById('copy-btn')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      const btn = document.getElementById('copy-btn') as HTMLButtonElement
      const original = btn.textContent
      btn.textContent = '已複製 ✓'
      setTimeout(() => { btn.textContent = original }, 1500)
    } catch {
      // clipboard blocked — user can still select the input manually
    }
  })

  if (!alreadyConfirmed) {
    document.getElementById('confirm-btn')!.addEventListener('click', confirmReady)
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/lobby.ts
git commit -m "feat(client): show share link + QR in lobby; display formatProgress"
```

---

## Task 14: Answer screen — replace `maxRounds` with `formatProgress`

**Files:**
- Modify: `client/src/screens/answer.ts`

- [ ] **Step 1: Update the round-progress line**

In `client/src/screens/answer.ts`, find:

```ts
      <p style="font-size:0.85rem;color:#666">第 ${room.round}/${room.maxRounds} 回合</p>
```

Replace with:

```ts
      <p style="font-size:0.85rem;color:#666">${escapeHtml(formatProgress(room))}</p>
```

Add the import at the top:

```ts
import { formatProgress } from '../utils/progress'
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: no errors (the `maxRounds` field no longer exists, so the old reference would have errored — confirm the new version compiles).

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/answer.ts
git commit -m "feat(client): use formatProgress on answer screen"
```

---

## Task 15: Results screen — correct-answer card + `formatProgress`

**Files:**
- Modify: `client/src/screens/results.ts`

- [ ] **Step 1: Insert correct-answer card and update top heading**

In `client/src/screens/results.ts`:

1. Add the import:

```ts
import { formatProgress } from '../utils/progress'
```

2. Replace the heading block — currently:

```ts
    <h1>回合結果</h1>
    ${aiGuessNote}
```

with:

```ts
    <h1>回合結果</h1>
    <p style="text-align:center;color:#666;font-size:0.85rem">${escapeHtml(formatProgress(room))}</p>
    <div class="card" style="border:2px solid #16a34a">
      <p style="font-size:0.85rem;color:#16a34a;font-weight:bold">📖 正確解答</p>
      <h3 style="margin-top:8px">${escapeHtml(room.currentWord)}</h3>
      <p style="margin-top:8px;line-height:1.6">${escapeHtml(room.currentWordCorrect)}</p>
    </div>
    ${aiGuessNote}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/results.ts
git commit -m "feat(client): show correct answer card on results screen"
```

---

## Task 16: End-to-end manual verification

**Files:** none

- [ ] **Step 1: Boot dev**

Run: `npm run dev`
Expected: server on 3001, client on Vite port (e.g. 5173). Open two browser windows.

- [ ] **Step 2: Create a room with custom settings**

In window A, open `http://localhost:5173/`. Expand 進階設定, set 作答時間=30s, 投票時間=20s, 結束條件=目標分數 5. Pick a pool, enter nickname, click 建立房間.

Expected:
- Lobby shows a 4-digit code, share URL (form `http://localhost:5173/?room=XXXX`), QR image.
- Progress line reads `第 0 回合｜目標 5 分`.

- [ ] **Step 3: Join via share URL**

In window B, open the share URL from window A's share-link input. The home-screen room code field should be pre-filled with the 4-digit code. Enter a different nickname, click 加入. Both windows now show 2 players in lobby.

- [ ] **Step 4: Play one round**

Both press 準備好了. Word appears with a 30 s countdown. Both submit answers. Voting starts with a 20 s countdown. Both vote.

Expected at round result:
- A green-bordered card titled 📖 正確解答 shows the word and its definition.
- Below it, all answers (player + AI) with vote counts.
- Progress line at top is `第 1 回合｜目標 5 分`.

- [ ] **Step 5: Hit the score target**

Continue rounds until any player reaches 5 points.

Expected: game transitions to `GAME_OVER`. (If you never hit 5, the safety cap kicks in at round 30 — fine for the test.)

- [ ] **Step 6: Verify QR works**

On a phone on the same LAN/Wi-Fi, scan the QR from window A's lobby. The phone should open the join page with the room code pre-filled. (If running locally with localhost, the QR will encode `http://localhost:...` which a phone can't reach — this is fine for dev; verify the URL value is correct.)

- [ ] **Step 7: No commit needed**

This step is verification only.

---

## Self-Review (writer's checklist)

**Spec coverage**

- §1 data model → Tasks 1, 2 ✓
- §2 4-digit code + URL prefill + lobby share UI → Tasks 3, 12, 13 ✓
- §3 advanced settings form, API, timers, end condition → Tasks 5, 6, 7, 8, 12 ✓
- §4 currentWordCorrect → Tasks 2, 4, 7 (server), 15 (client) ✓
- §5 tests + qrcode dep + 120 s constants + answer.ts maxRounds removal + utils/progress → Tasks 3–8 (tests), 7 (120 s), 10 (qrcode), 11 (utils), 14 (answer.ts) ✓

**No placeholders:** complete code in every step; no "TBD" / "similar to" / "handle edge cases" left. ✓

**Type consistency:** `GameSettings.answerInputMs`/`votingMs`/`endCondition` consistent across types, settings.ts, server, client. `formatProgress(room)` signature reused unchanged in three call sites. `parseSettings` `ParseResult` discriminated union used consistently. ✓
