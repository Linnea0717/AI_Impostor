// server/llm/provider.ts
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai, createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let promptPrefix: string
try {
  promptPrefix = readFileSync(
    join(__dirname, '../data/definition-prompt.txt'),
    'utf-8'
  ).trim()
} catch (err) {
  throw new Error(`Failed to load LLM prompt file: ${err}`)
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  ollama: 'llama3.2',
}

function getModel() {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  const model = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider] ?? 'claude-haiku-4-5-20251001'
  if (provider === 'openai') return openai(model)
  if (provider === 'google') {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
    return createGoogleGenerativeAI({ apiKey })(model)
  }
  if (provider === 'groq') {
    return createGroq({ apiKey: process.env.GROQ_API_KEY })(model)
  }
  if (provider === 'ollama') {
    const ollamaClient = createOpenAI({
      baseURL: (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434') + '/v1',
    })
    return ollamaClient(model)
  }
  return anthropic(model)
}

export async function generateDefinition(word: string): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    prompt: `${promptPrefix}\n\n現在請用上述風格，為以下詞彙寫一段假定義，不要超過80個字：\n詞彙：${word}`,
    // maxTokens: 200,
  })
  return text.trim()
}

export async function guessDefinition(
  answers: { id: string; text: string }[]
): Promise<string> {
  if (answers.length === 0) throw new Error('guessDefinition called with empty answers array')

  const formatted = answers
    .map((a, i) => `${i + 1}. [ID: ${a.id}] ${a.text}`)
    .join('\n')
  const { text } = await generateText({
    model: getModel(),
    prompt: `以下是幾則對某個詞彙的解釋，其中一則是由 AI 生成的。請判斷哪一則最像 AI 所寫，並只回覆該則的 ID（格式為 UUID，不要包含任何其他文字）：\n\n${formatted}`,
    // maxTokens: 50,
  })
  const raw = text.trim()
  // Try exact match first, then substring match to handle quoted/decorated responses
  const match = answers.find(a => raw === a.id || raw.includes(a.id))
  return match ? match.id : answers[0].id
}
