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
