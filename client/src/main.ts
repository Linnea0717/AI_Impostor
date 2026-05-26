import { connect, joinRoom, getMyPlayerId } from './socket'
import { render as renderLobby } from './screens/lobby'
import { render as renderAnswer } from './screens/answer'
import { render as renderVoting } from './screens/voting'
import { render as renderResults } from './screens/results'
import { render as renderGameover } from './screens/gameover'
import type { PublicRoom } from '~shared/types'
import { escapeHtml } from './utils'

const app = document.getElementById('app')!

function showError(msg: string): void {
  const el = document.createElement('p')
  el.style.cssText = 'color:red;margin-top:8px'
  el.textContent = msg
  app.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}

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
      <input id="room-code" placeholder="輸入房號" maxlength="4" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(prefillRoom)}" />
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
