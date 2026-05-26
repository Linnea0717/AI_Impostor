import { voteForAnswer, getMySubmittedText } from '../socket'
import type { PublicRoom } from '~shared/types'
import { escapeHtml } from '../utils'
import { formatProgress } from '../utils/progress'
import { startCountdown } from '../timer'

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadyVoted = myPlayer?.hasVoted ?? false
  const votedCount = room.players.filter(p => p.hasVoted).length + (room.aiGuesserVoted ? 1 : 0)
  const totalVoters = room.players.length + 1  // +1 for AI guesser
  const myText = getMySubmittedText()

  app.innerHTML = `
    <div class="card">
      <p style="font-size:0.85rem;color:#666">投票階段・${escapeHtml(formatProgress(room))}</p>
      <div class="timer" id="countdown">--</div>
      <h2>${escapeHtml(room.currentWord)}</h2>
      <p style="margin-top:8px;color:#666;font-size:0.9rem">哪一則是 AI 寫的？</p>
    </div>
    ${alreadyVoted
      ? `<div class="card" style="text-align:center;color:#16a34a">✅ 已投票！等待其他玩家…<br><small>${votedCount}/${totalVoters} 人完成</small></div>`
      : ''
    }
    ${room.answers.map((a, i) => {
      const isOwn = myText !== null && a.text === myText
      const dimStyle = isOwn ? 'opacity:0.4;' : ''
      const cursorStyle = `cursor:${alreadyVoted || isOwn ? 'default' : 'pointer'};`
      return `
        <div class="card answer-card${isOwn ? ' own-answer' : ''}"
             data-id="${a.id}"
             style="${cursorStyle}${dimStyle}">
          <span style="color:#6c3aed;font-weight:bold">${String.fromCharCode(65 + i)}.</span>
          ${escapeHtml(a.text)}
          ${isOwn ? '<br><small style="color:#999">（你的答案）</small>' : ''}
        </div>`
    }).join('')}
  `

  startCountdown(room.timerEndsAt)

  if (!alreadyVoted) {
    app.querySelectorAll('.answer-card:not(.own-answer)').forEach(card => {
      card.addEventListener('click', () => {
        const answerId = (card as HTMLElement).dataset.id!
        app.querySelectorAll('.answer-card').forEach(c => c.classList.remove('selected'))
        card.classList.add('selected')
        voteForAnswer(answerId)
      })
    })
  }
}
