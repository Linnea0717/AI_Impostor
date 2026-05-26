# 偽百科詞典：自訂設定 / 分享連結 / 公佈正解

Date: 2026-05-26

## Goal

四項使用者要求的功能增補：

1. 房號縮短為 4 碼純數字。
2. 大廳顯示房間分享連結與 QR code。
3. 房主可在建房表單自訂作答時間、投票時間、結束條件（固定回合數或目標分數），各有上下限。
4. 每回合結束時公佈該詞的正確解答。

附帶調整：大廳閒置超時 `LOBBY_CONFIRM_MS` 與解答公佈停留時間 `ROUND_RESULT_MS` 都改為 120,000 ms。

## Non-goals

- 玩家中途離開重連時不需要重抽 settings。
- 不做 settings 在大廳階段由房主動態修改（settings 在建房時就鎖定）。
- 不持久化房間狀態（仍是 in-memory）。
- 不為 score-mode 加自訂安全帽，內建 `SCORE_MODE_SAFETY_CAP = 30` 即可。

---

## §1 — 共享資料模型

`shared/types.ts`：

```ts
export interface GameSettings {
  answerInputMs: number
  votingMs: number
  endCondition:
    | { type: 'rounds'; value: number }
    | { type: 'score';  value: number }
}

export interface Room {
  // 既有欄位...
  settings: GameSettings           // 新增；取代固定 maxRounds: 5
  currentWordCorrect: string       // 新增；只在 ROUND_RESULT 對外公開
}
```

`PublicRoom` 同步加 `currentWordCorrect: string`。`maxRounds` 欄位移除。

`shared/config.ts`（新檔）— 對外單位皆為「秒」：

```ts
export const SETTINGS_BOUNDS = {
  answerInputSec: { min: 30, max: 180, default: 90 },
  votingSec:      { min: 20, max: 90,  default: 45 },
  rounds:         { min: 3,  max: 10,  default: 5 },
  score:          { min: 5,  max: 30,  default: 15 },
} as const

export const ROOM_CODE_LENGTH = 4
export const SCORE_MODE_SAFETY_CAP = 30
```

`toPublicRoom` 改寫：

```ts
const reveal = room.state === 'ROUND_RESULT'
return {
  ...room,
  currentWordCorrect: reveal ? room.currentWordCorrect : '',
  // 既有 answers / aiGuesserVote 處理保持不變
}
```

---

## §2 — 4 碼數字房號 + 分享 UI

**房號生成**（`server/game/room.ts`）：

```ts
function generateCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}
```

**碰撞處理**：`POST /api/rooms` 重試上限從 5 提到 50（10,000 個房號，100 並發以下無感）。

**首頁支援 URL 預填**：

- 分享連結格式：`{origin}/?room=1234`
- `client/src/main.ts` `renderHome()` 開頭讀 `new URLSearchParams(location.search).get('room')`，若存在：
  - 自動填入「加入房間」的房號欄位
  - 不自動連線；仍要求使用者輸入暱稱後手動按「加入」

**Lobby 分享 UI**（`client/src/screens/lobby.ts`）：

在房號區塊下方新增一張卡片：

```
分享連結：https://app.url/?room=1234  [複製]
[QR code 圖片，約 160×160 px]
```

- QR 用 `qrcode` npm 套件在 client 本地產生 data URL，不打伺服器。
- 「複製」按鈕呼叫 `navigator.clipboard.writeText(url)`，加 toast 提示。
- URL 用 `window.location.origin + '/?room=' + room.code` 拼出。
- QR 渲染做 once-only：在 lobby render 時若 QR 已存在（同房號）則不重產，避免 socket broadcast 重繪閃爍。

**安全**：URL 參數只當 UI 預填，房號驗證仍由 server 端 `player:join` 處理。

---

## §3 — 自訂遊戲設定

**首頁建房表單**（`client/src/main.ts`）：

在「建立房間」卡片底下新增 `<details>` 折疊區（預設摺起）：

```
題庫：[下拉]
你的暱稱：[輸入]
▸ 進階設定
    作答時間：[−] 90 秒 [+]   範圍 30–180
    投票時間：[−] 45 秒 [+]   範圍 20–90
    結束條件：
      ◉ 固定回合數 [−] 5 [+]   範圍 3–10
      ○ 達到目標分數 [−] 15 [+]   範圍 5–30
[建立房間]
```

- `<input type="number">` + 「−/+」按鈕，作答/投票步進 5 秒，回合/分數步進 1。
- Radio 互斥；切換時對應 input `disabled` 切換。
- 客端對輸入即時 clamp 到範圍內。

**API**：`POST /api/rooms` body 擴充：

```ts
{
  questionPool: string,
  answerInputSec?: number,
  votingSec?: number,
  endCondition?: { type: 'rounds' | 'score', value: number }
}
```

**`parseSettings(body)` helper**（`server/index.ts`）：

- 缺值套 `SETTINGS_BOUNDS.*.default`
- 超出範圍 → 400 `{ error: 'settings_out_of_range', field: '...', min, max }`
- 通過後組成 `GameSettings`（秒 × 1000 = ms）

`createRoom` 簽名改為 `createRoom(poolId, poolName, settings)`。

**Timer 使用 room.settings**（`server/index.ts`）：

- `advanceToWordGeneration`：`timerEndsAt = Date.now() + room.settings.answerInputMs`
- `advanceToVoting`：`timerEndsAt = Date.now() + room.settings.votingMs`
- AI 超時改相對：
  - `aiDefinitionTimeoutMs = room.settings.answerInputMs - 2000`
  - `aiGuesserTimeoutMs = room.settings.votingMs - 2000`
  - 確保 AI 在階段結束前 2 秒回完或落 fallback。

**結束條件**（`advanceFromRoundResult`）：

```ts
const { settings, scores, round } = room
const reached =
  settings.endCondition.type === 'rounds'
    ? round >= settings.endCondition.value
    : Object.values(scores).some(s => s >= settings.endCondition.value)
        || round >= SCORE_MODE_SAFETY_CAP

if (reached) advanceToGameOver(code)
else advanceToWordGeneration(code)
```

**Lobby/Result 顯示**：

- 若 `type === 'rounds'`：「第 N / M 回合」
- 若 `type === 'score'`：「第 N 回合｜目標 X 分」

---

## §4 — 回合結束公佈正確解答

**Server 抽詞時記下正解**（`advanceToWordGeneration`）：

```ts
room = { ...room,
  state: 'ANSWER_INPUT',
  currentWord: entry.word,
  currentWordCorrect: entry.fallback,
  timerEndsAt: Date.now() + room.settings.answerInputMs,
  aiSubmitted: false,
}
```

**對外揭露**：`toPublicRoom` 已在 §1 改寫，只在 `ROUND_RESULT` 階段把 `currentWordCorrect` 送出。

**Result 畫面**（`client/src/screens/results.ts`）：

在 `<h1>回合結果</h1>` 下方插入一張綠色邊框的「正確解答」卡片：

```html
<div class="card" style="border:2px solid #16a34a">
  <p style="font-size:0.85rem;color:#16a34a;font-weight:bold">📖 正確解答</p>
  <h3 style="margin-top:8px">${escapeHtml(room.currentWord)}</h3>
  <p style="margin-top:8px;line-height:1.6">${escapeHtml(room.currentWordCorrect)}</p>
</div>
```

位置在玩家答案列表之前。

**已知權衡**：當 AI 生成失敗時，AI 的答案 = fallback = 正解，等於這回合 AI 把答案秀出來。維持現狀，不額外處理。

---

## §5 — 測試、套件、雜項

**寫死的兩個常數**（`server/index.ts`）：

```ts
const LOBBY_CONFIRM_MS = 120_000
const ROUND_RESULT_MS = 120_000
```

`ANSWER_INPUT_MS`、`VOTING_MS`、`AI_DEFINITION_TIMEOUT_MS`、`AI_GUESSER_TIMEOUT_MS` 移除常數，改從 `room.settings` 計算。

**測試異動**：

- `server/game/__tests__/room.test.ts`：
  - `createRoom` 所有呼叫點加 `settings` 參數（建議 `makeTestSettings()` helper）。
  - 新增：4 碼房號全為 `0-9`、長度 4。
- 新檔 `server/__tests__/settings-parsing.test.ts`：覆蓋三條路徑 — 缺值套預設、邊界值通過、超出範圍回 400。
- `server/game/__tests__/wordbank.test.ts`：不動。

**Migration**：

- 房間狀態都在記憶體，重啟即清空，無需 migration。
- JSON pool 檔格式不變；`fallback` 語意擴充為「正解 + AI 備援」。
- Client `localStorage` 只存 `playerToken`，不影響。

**Client 套件**：

- `npm install qrcode --workspace=client`
- `npm install -D @types/qrcode --workspace=client`

**檔案異動清單**：

- `shared/types.ts`
- `shared/config.ts`（新檔）
- `server/game/room.ts`
- `server/game/__tests__/room.test.ts`
- `server/index.ts`
- `server/__tests__/settings-parsing.test.ts`（新檔）
- `client/src/main.ts`
- `client/src/screens/lobby.ts`
- `client/src/screens/results.ts`
- `client/package.json`

---

## Open questions

無（所有設計決策已在 brainstorm 階段確認）。
