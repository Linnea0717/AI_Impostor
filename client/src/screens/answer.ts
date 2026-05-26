import { submitAnswer } from '../socket'
import type { PublicRoom } from '~shared/types'
import { escapeHtml } from '../utils'
import { startCountdown } from '../timer'

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadySubmitted = myPlayer?.hasSubmitted ?? false
  const submittedCount = room.players.filter(p => p.hasSubmitted).length + (room.aiSubmitted ? 1 : 0)
  const totalCount = room.players.length + 1  // +1 for AI

  if (room.state === 'WORD_GENERATION') {
    app.innerHTML = `
      <div style="text-align:center;padding:40px 0">
        <p style="font-size:1.2rem;color:#666">正在生成題目…</p>
        <p style="font-size:2rem;margin-top:16px">🎲</p>
      </div>
    `
    return
  }

  // If the input form is already on screen and the player still hasn't submitted,
  // skip the re-render so their typed text is preserved when other players' state
  // updates broadcast in. Nothing visible to a non-submitted player changes.
  if (!alreadySubmitted && document.getElementById('answer-input')) {
    return
  }

  // If submitted view is already on screen, only update the count text.
  const statusEl = document.getElementById('submit-status')
  if (alreadySubmitted && statusEl) {
    statusEl.innerHTML = `✅ 已送出！等待其他玩家…<br><small>${submittedCount}/${totalCount} 人完成</small>`
    return
  }

  app.innerHTML = `
    <div class="card">
      <p style="font-size:0.85rem;color:#666">第 ${room.round}/${room.maxRounds} 回合</p>
      <div class="timer" id="countdown">--</div>
      <h2 style="text-align:center;font-size:1.4rem">${escapeHtml(room.currentWord)}</h2>
    </div>
    <div class="card">
      ${alreadySubmitted
        ? `<p id="submit-status" style="text-align:center;color:#16a34a">✅ 已送出！等待其他玩家…<br><small>${submittedCount}/${totalCount} 人完成</small></p>`
        : `<textarea id="answer-input" placeholder="請根據題目瞎掰出一段描述" rows="4" maxlength="200"></textarea>
           <button id="submit-btn">送出答案</button>`
      }
    </div>
  `

  startCountdown(room.timerEndsAt)

  if (!alreadySubmitted) {
    document.getElementById('submit-btn')!.addEventListener('click', () => {
      const text = (document.getElementById('answer-input') as HTMLTextAreaElement).value.trim()
      if (!text) return
      submitAnswer(text)
    })
  }
}
