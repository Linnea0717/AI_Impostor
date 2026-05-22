// server/llm/__tests__/provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the 'ai' module before importing provider
vi.mock('ai', () => ({
  generateText: vi.fn(),
}))
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn(() => 'mock-anthropic-model'),
}))
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn(() => 'mock-openai-model'),
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-ollama-model')),
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => 'mock-google-model')),
}))

import { generateText } from 'ai'
import { generateDefinition, guessDefinition } from '../provider'

const mockGenerateText = vi.mocked(generateText)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.LLM_PROVIDER = 'anthropic'
  process.env.LLM_MODEL = 'claude-haiku-4-5-20251001'
})

describe('generateDefinition', () => {
  it('returns trimmed text from the LLM', async () => {
    mockGenerateText.mockResolvedValue({ text: '  這是一個很厲害的東西  ' } as any)
    const result = await generateDefinition('量子糾纏麵包')
    expect(result).toBe('這是一個很厲害的東西')
  })

  it('includes the word in the prompt', async () => {
    mockGenerateText.mockResolvedValue({ text: 'def' } as any)
    await generateDefinition('量子糾纏麵包')
    const call = mockGenerateText.mock.calls[0][0]
    expect((call as any).prompt).toContain('量子糾纏麵包')
  })

  it('throws when LLM call fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('API error'))
    await expect(generateDefinition('test')).rejects.toThrow()
  })
})

describe('guessDefinition', () => {
  it('returns an answerId from the provided list', async () => {
    const answers = [
      { id: 'uuid-1', text: 'first answer' },
      { id: 'uuid-2', text: 'second answer' },
    ]
    mockGenerateText.mockResolvedValue({ text: 'uuid-1' } as any)
    const result = await guessDefinition(answers)
    expect(result).toBe('uuid-1')
  })

  it('falls back to first answer if LLM returns an unrecognised ID', async () => {
    const answers = [
      { id: 'uuid-1', text: 'first answer' },
      { id: 'uuid-2', text: 'second answer' },
    ]
    mockGenerateText.mockResolvedValue({ text: 'not-a-valid-id' } as any)
    const result = await guessDefinition(answers)
    expect(result).toBe('uuid-1')
  })

  it('throws when LLM call fails', async () => {
    mockGenerateText.mockRejectedValue(new Error('API error'))
    await expect(guessDefinition([{ id: 'x', text: 'y' }])).rejects.toThrow()
  })
})
