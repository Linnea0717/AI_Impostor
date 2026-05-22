import { voteForAnswer } from '../socket'
import type { PublicRoom } from '~shared/types'
import { escapeHtml } from '../utils'

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
        ${escapeHtml(a.text)}
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
