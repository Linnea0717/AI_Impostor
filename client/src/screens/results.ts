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
