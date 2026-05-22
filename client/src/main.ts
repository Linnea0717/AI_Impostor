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
    .catch(() => showError('無法載入題庫列表'))

  document.getElementById('create-btn')!.addEventListener('click', async () => {
    const pool = (document.getElementById('pool-select') as HTMLSelectElement).value
    const nickname = (document.getElementById('host-nickname') as HTMLInputElement).value.trim()
    if (!nickname) { showError('請輸入暱稱'); return }
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionPool: pool }),
      })
      const { code } = await res.json()
      startGame(code, nickname)
    } catch {
      showError('建立房間失敗，請重試')
    }
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
