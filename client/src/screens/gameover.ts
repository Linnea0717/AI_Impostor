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
