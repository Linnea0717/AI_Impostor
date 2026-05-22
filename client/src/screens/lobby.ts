import { confirmReady } from '../socket'
import type { PublicRoom } from '~shared/types'
import { escapeHtml } from '../utils'

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const confirmedCount = room.players.filter(p => p.hasConfirmed).length
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadyConfirmed = myPlayer?.hasConfirmed ?? false

  app.innerHTML = `
    <h1>偽百科詞典</h1>
    <div class="card">
      <p style="font-size:0.85rem;color:#666">房號</p>
      <p style="font-size:2rem;font-weight:bold;letter-spacing:0.2em">${escapeHtml(room.code)}</p>
      <p style="font-size:0.85rem;color:#666;margin-top:4px">題庫：${escapeHtml(room.questionPool)}</p>
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

  if (!alreadyConfirmed) {
    document.getElementById('confirm-btn')!.addEventListener('click', confirmReady)
  }
}
