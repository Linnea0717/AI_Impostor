import type { PublicRoom } from '~shared/types'

export function formatProgress(room: PublicRoom): string {
  const ec = room.settings.endCondition
  if (ec.type === 'rounds') {
    return `第 ${room.round}/${ec.value} 回合`
  }
  return `第 ${room.round} 回合｜目標 ${ec.value} 分`
}
