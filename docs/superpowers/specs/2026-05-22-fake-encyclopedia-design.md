# 規格書：偽百科詞典 Web 派對遊戲

**日期：** 2026-05-22  
**狀態：** 已核准

---

## 1. 系統概述

一款支援 3–8 名玩家在區域網路上即時連線的派對遊戲。每回合系統從題庫中抽取一個冷僻或虛構的專有名詞，玩家各自撰寫假造的百科式定義，同時由 LLM 生成一則 AI 定義混入其中。玩家投票找出哪一則是 AI 所寫，依表現計算分數。

玩家無需下載 App，掃描 QR Code 或輸入房號即可在手機瀏覽器中加入遊戲。

---

## 2. 技術選型

| 層級 | 選擇 | 理由 |
|---|---|---|
| 後端執行環境 | Node.js | 即時 WebSocket 遊戲最成熟的生態系 |
| HTTP + WS 伺服器 | Express + Socket.io | REST 負責建立房間，Socket.io 負責遊戲事件 |
| 前端建置工具 | Vite + 原生 TypeScript | 型別安全、熱重載，無框架負擔 |
| LLM 抽象層 | Vercel AI SDK（`ai` 套件） | 統一介面支援 OpenAI、Anthropic、Ollama |
| 共用型別 | `shared/types.ts` | 前後端共用的單一型別來源 |

---

## 3. 專案結構

```
/
├── server/
│   ├── index.ts              # Express 應用 + Socket.io 初始化
│   ├── game/
│   │   ├── room.ts           # 房間狀態機（所有遊戲邏輯）
│   │   ├── scoring.ts        # 分數計算
│   │   └── wordbank.ts       # 題庫抽題（讀取 words.json）
│   ├── llm/
│   │   └── provider.ts       # Vercel AI SDK 介面卡，讀取 .env
│   └── data/
│       ├── definition-prompt.txt # 假人類 LLM 的人設提示詞前綴（可自由編輯）
│       └── pools/            # 題庫資料夾，每個 JSON 對應一個題庫
│           ├── rare.json         # 冷僻詞彙
│           ├── common.json       # 常見詞彙
│           └── storytelling.json # 故事情境
├── client/
│   ├── index.html
│   └── src/
│       ├── main.ts           # 進入點 + 畫面路由
│       ├── socket.ts         # Socket.io 客戶端封裝
│       └── screens/
│           ├── lobby.ts
│           ├── answer.ts
│           ├── voting.ts
│           ├── results.ts
│           └── gameover.ts
├── shared/
│   └── types.ts              # 前後端共用介面定義
├── .env.example
└── package.json
```

---

## 4. 遊戲狀態機

所有狀態以伺服器為唯一權威來源。客戶端依據每次收到的 `room:state-update` 事件中的 `room.state` 決定顯示哪個畫面。

```
LOBBY → WORD_GENERATION → ANSWER_INPUT → VOTING → ROUND_RESULT → （循環或 GAME_OVER）
```

| 狀態轉換 | 觸發者 | 條件 |
|---|---|---|
| LOBBY → WORD_GENERATION | 伺服器 | 所有玩家發送 `game:confirm`，或 60 秒逾時 |
| WORD_GENERATION → ANSWER_INPUT | 伺服器自動 | 題目抽出且 LLM 呼叫已啟動 |
| ANSWER_INPUT → VOTING | 伺服器 | 所有玩家已送出答案，或 60 秒倒數結束 |
| VOTING → ROUND_RESULT | 伺服器 | 所有玩家已投票，或 45 秒倒數結束（AI 猜題器在 VOTING 開始時同步呼叫，結果於 ROUND_RESULT 一併揭露） |
| ROUND_RESULT → WORD_GENERATION | 伺服器 | 所有玩家發送 `game:confirm`，或 15 秒逾時 |
| ROUND_RESULT → GAME_OVER | 伺服器自動 | `round === maxRounds`（優先於上一條） |

---

## 5. 資料模型

### 共用型別（`shared/types.ts`）

```typescript
type GameState =
  | "LOBBY"
  | "WORD_GENERATION"
  | "ANSWER_INPUT"
  | "VOTING"
  | "ROUND_RESULT"
  | "GAME_OVER"

interface Player {
  id: string          // 穩定的 UUID（存於客戶端 localStorage，重新連線後仍有效）
  socketId: string    // 目前的 Socket ID（重連後會變更）
  nickname: string
  hasConfirmed: boolean  // LOBBY 與 ROUND_RESULT 階段的「準備好了」狀態
  hasSubmitted: boolean
  hasVoted: boolean
}

interface Answer {
  id: string          // uuid
  text: string
  authorId: string    // 玩家 UUID 或 "AI"
  votes: string[]     // 投票者的玩家 UUID 列表
}

interface Room {
  code: string
  hostId: string      // 房主的玩家 UUID
  questionPool: string  // 題庫名稱，對應 data/pools/<name>.json
  players: Player[]
  state: GameState
  round: number       // 從 1 開始計算
  maxRounds: number   // 預設 5
  currentWord: string
  answers: Answer[]      // 已洗牌；VOTING 階段廣播前移除 authorId
  aiGuesserVote: string | null  // AI 猜題器選擇的 answerId；VOTING 期間為 null，ROUND_RESULT 時揭露
  scores: Record<string, number>  // 以玩家 UUID 為鍵
  timerEndsAt: number    // Unix 毫秒時間戳；客戶端自行計算倒數
}
```

### 伺服器端房間登錄表

```typescript
const rooms = new Map<string, Room>()  // 鍵為房號，例如 rooms.get("XKCD42")
```

所有狀態存於記憶體，不需要資料庫。

---

## 6. API 合約

### REST 端點

| 方法 | 路徑 | 請求內容 | 回應內容 |
|---|---|---|---|
| GET | `/api/pools` | — | `{ pools: string[] }` 可用題庫名稱列表（掃描 `data/pools/` 目錄） |
| POST | `/api/rooms` | `{ questionPool: string }` | `{ code: string }` |

建立房間前，客戶端先呼叫 `/api/pools` 取得可用題庫列表供玩家選擇，再以選定的題庫名稱建立房間。房間建立後題庫不可更換。玩家實際加入房間的動作透過 Socket.io 連線後的 `player:join` 事件完成。

### Socket.io 事件

**客戶端 → 伺服器**

| 事件 | 資料 | 觸發時機 |
|---|---|---|
| `player:join` | `{ code: string, nickname: string, token?: string }` | Socket 連線後的第一個事件。`token` 為存於 localStorage 的 UUID，用於重新連線識別。 |
| `game:confirm` | — | 於 LOBBY 或 ROUND_RESULT 狀態，表示「我準備好了／繼續下一回合」。所有玩家確認或逾時後伺服器自動推進狀態。 |
| `game:submit-answer` | `{ text: string }` | ANSWER_INPUT 階段 |
| `game:vote` | `{ answerId: string }` | VOTING 階段 |

**伺服器 → 客戶端**

| 事件 | 資料 | 說明 |
|---|---|---|
| `room:state-update` | 完整 `Room` 快照 | 每次狀態變更時廣播給所有玩家。VOTING 階段廣播的答案會移除 `authorId`。 |
| `room:error` | `{ message: string }` | 僅發送給觸發錯誤的客戶端 |

---

## 7. 計分規則

| 條件 | 分數 |
|---|---|
| 其他玩家投票給你的假定義（你成功騙到人） | 每票 +1 分 |
| 你正確識別出 AI 生成的答案 | +2 分 |
| 沒有任何玩家識別出 AI 答案（AI 勝出） | 每位有送出答案的玩家各 +1 分 |

分數跨回合累計。GAME_OVER 狀態顯示最終排行榜與 MVP（得分最高者）。

---

## 8. LLM 提供者

透過 `.env` 設定。`server/llm/provider.ts` 模組在啟動時讀取設定，對外提供統一的 `generateDefinition(word: string): Promise<string>` 函式。

```env
LLM_PROVIDER=anthropic          # anthropic | openai | ollama
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...           # provider=openai 時使用
OLLAMA_BASE_URL=http://localhost:11434  # provider=ollama 時使用（本地 Llama）
```

`server/llm/provider.ts` 對外提供兩個函式：

| 函式 | 呼叫時機 | 說明 |
|---|---|---|
| `generateDefinition(word)` | WORD_GENERATION 階段 | 以 `definition-prompt.txt` 的人設前綴 + 詞彙組合成完整提示詞，生成假定義 |
| `guessDefinition(answers)` | VOTING 開始時（與人類投票並行） | 接收匿名答案列表，回傳猜測為 AI 所寫的 `answerId` |

兩個函式使用相同的 LLM 提供者設定，但為獨立的 API 呼叫（可視為不同 session，互不共享上下文）。

**`generateDefinition` 提示詞結構：**
```
[definition-prompt.txt 的內容]

現在請用上述風格，為以下詞彙寫一段假定義，不要超過兩句：
詞彙：{word}
```
`definition-prompt.txt` 範例內容：
```
你是一個台灣年輕人，講話很隨性、愛用網路用語，有時候會夾雜一些英文。
你現在要假裝自己知道一個詞彙的意思，然後用自信但其實是瞎掰的方式解釋它。
```
伺服器啟動時載入此檔案並快取，修改後重啟伺服器即可生效。

**`guessDefinition` 提示詞：** 提供所有匿名答案，要求模型判斷哪一則最像 AI 生成（過於工整、學術、無人味），回傳對應的 ID。

**備援機制：**
- `generateDefinition` 失敗或逾時（5 秒）：改用 `words.json` 中的 `fallback` 欄位，回合照常進行。
- `guessDefinition` 失敗或逾時（45 秒，與投票階段同步）：`aiGuesserVote` 設為 `"TIMEOUT"`，ROUND_RESULT 畫面顯示「AI 未能作答」。

---

## 9. 題庫格式（`server/data/pools/<name>.json`）

每個題庫為獨立的 JSON 檔案，放於 `server/data/pools/` 目錄下。伺服器啟動時不預先載入，而是在建立房間時依 `questionPool` 名稱動態讀取。

```json
[
  {
    "word": "量子糾纏麵包",
    "fallback": "一種理論性烘焙概念，指兩條麵包進入量子糾纏狀態，使其中一條的新鮮程度能瞬間影響另一條，無論兩者相距多遠。"
  }
]
```

新增題庫只需在 `pools/` 目錄下放入新的 JSON 檔案，無需修改程式碼。`/api/pools` 端點會自動掃描該目錄並回傳檔名（不含副檔名）作為題庫名稱。

每局遊戲（一個 Room 的生命週期）內隨機不重複抽題。若在同一房間開始新遊戲，題庫重置。

---

## 10. 錯誤處理

| 情境 | 處理方式 |
|---|---|
| 玩家中途斷線 | 從 `players[]` 移除，廣播 `room:state-update`。若房主斷線，自動將清單中下一位玩家升為房主。 |
| 玩家重新連線 | 透過 Socket.io 重連，發送帶有 `token` 的 `player:join`。伺服器以 UUID 比對，更新 `socketId`，並傳送完整當前狀態。 |
| LLM 呼叫失敗或逾時 | 使用 `words.json` 中的 `fallback` 定義，回合照常進行。 |
| 建立房間時房號碰撞 | 重新產生房號並重試（最多 5 次）。 |
| 收到不符當前狀態的操作 | 僅向該客戶端發送 `room:error`，忽略該操作。 |
| 計時結束後才送出答案 | 伺服器忽略，狀態已推進。 |

---

## 11. 客戶端畫面總覽

| 檔案 | 顯示於 `room.state` = | 主要元素 |
|---|---|---|
| `lobby.ts` | LOBBY | 房號顯示、玩家列表、「準備好了」按鈕（所有人皆可按）、已確認人數顯示 |
| `answer.ts` | WORD_GENERATION、ANSWER_INPUT | 詞彙顯示、倒數計時器、文字輸入框、送出按鈕 |
| `voting.ts` | VOTING | 洗牌後的匿名答案列表（不顯示作者），點選投票 |
| `results.ts` | ROUND_RESULT | **每則答案的作者全部揭露**（包含哪則是 AI）、各答案得票數、**AI 猜題器的選擇標示於對應答案旁**（供玩家與自己的判斷對比）、本回合每位玩家的分數變化、累計計分板、「繼續」按鈕（所有人皆可按）、已確認人數顯示 |
| `gameover.ts` | GAME_OVER | 最終排行榜、MVP highlight、再玩一局按鈕 |

`main.ts` 進入點監聽 `room:state-update` 事件，並呼叫對應畫面的 `render(room)` 函式。每個畫面檔案僅匯出一個 `render` 函式，將內容寫入根元素 `<div id="app">`。

---

## 12. 不在本次範圍內

- 持久化帳號或跨局統計資料
- 旁觀者模式
- 由玩家自訂回合數（由房主統一設定）
- 聊天室或表情反應功能
- 正式部署設定（留待後續階段處理）
