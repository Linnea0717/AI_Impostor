import { io, type Socket } from 'socket.io-client'
import type { PublicRoom } from '~shared/types'

let socket: Socket
let myPlayerId: string | null = sessionStorage.getItem('playerId')

export function getMyPlayerId(): string | null {
  return myPlayerId
}

export function connect(onUpdate: (room: PublicRoom) => void, onError: (msg: string) => void): void {
  socket = io()
  socket.on('room:state-update', onUpdate)
  socket.on('room:error', ({ message }: { message: string }) => onError(message))
  socket.on('player:token', ({ token }: { token: string }) => {
    myPlayerId = token
    sessionStorage.setItem('playerId', token)
  })
}

export function joinRoom(code: string, nickname: string): void {
  const token = sessionStorage.getItem('playerId') ?? undefined
  socket.emit('player:join', { code, nickname, token })
}

export function confirmReady(): void {
  socket.emit('game:confirm')
}

export function submitAnswer(text: string): void {
  socket.emit('game:submit-answer', { text })
}

export function voteForAnswer(answerId: string): void {
  socket.emit('game:vote', { answerId })
}
