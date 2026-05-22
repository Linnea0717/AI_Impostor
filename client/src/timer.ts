let interval: ReturnType<typeof setInterval> | null = null
let activeEndsAt = 0

export function startCountdown(endsAt: number): void {
  if (interval !== null) clearInterval(interval)
  activeEndsAt = endsAt
  tick()
  interval = setInterval(tick, 500)
}

export function stop(): void {
  if (interval !== null) { clearInterval(interval); interval = null }
  activeEndsAt = 0
}

function tick(): void {
  const el = document.getElementById('countdown')
  if (!el) return
  const secsLeft = Math.max(0, Math.ceil((activeEndsAt - Date.now()) / 1000))
  el.textContent = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}`
}
