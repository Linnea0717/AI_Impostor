import { submitAnswer } from '../socket'
import type { PublicRoom } from '~shared/types'
import { escapeHtml } from '../utils'

let timerInterval: ReturnType<typeof setInterval> | null = null

export function render(room: PublicRoom, myId: string | null): void {
  const app = document.getElementById('app')!
  const myPlayer = room.players.find(p => p.id === myId)
  const alreadySubmitted = myPlayer?.hasSubmitted ?? false
  const submittedCount = room.players.filter(p => p.hasSubmitted).length

  if (room.state === 'WORD_GENERATION') {
    app.innerHTML = `
      <div style="text-align:center;padding:40px 0">
        <p style="font-size:1.2rem;color:#666">正在生成題目…</p>
        <p style="font-size:2rem;margin-top:16px">🎲</p>
      </div>
    `
    return
  }

  // Clear previous timer
  if (timerInterval) clearInterval(timerInterval)

  app.innerHTML = `
    <div class="card">
      <p style="font-size:0.85rem;color:#666">第 ${room.round}/${room.maxRounds} 回合</p>
      <div class="timer" id="countdown">--</div>
      <h2 style="text-align:center;font-size:1.4rem">${escapeHtml(room.currentWord)}</h2>
    </div>
    <div class="card">
      ${alreadySubmitted
        ? `<p style="text-align:center;color:#16a34a">✅ 已送出！等待其他玩家…<br><small>${submittedCount}/${room.players.length} 人完成</small></p>`
        : `<textarea id="answer-input" placeholder="幫這個詞彙瞎掰一個假定義…" rows="4" maxlength="200"></textarea>
           <button id="submit-btn">送出答案</button>`
      }
    </div>
  `

  // Countdown timer
  function tick() {
    const el = document.getElementById('countdown')
    if (!el) { if (timerInterval) { clearInterval(timerInterval); timerInterval = null } return }
    const secsLeft = Math.max(0, Math.ceil((room.timerEndsAt - Date.now()) / 1000))
    el.textContent = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}`
  }
  tick()
  timerInterval = setInterval(tick, 500)

  if (!alreadySubmitted) {
    document.getElementById('submit-btn')!.addEventListener('click', () => {
      const text = (document.getElementById('answer-input') as HTMLTextAreaElement).value.trim()
      if (!text) return
      submitAnswer(text)
    })
  }
}
