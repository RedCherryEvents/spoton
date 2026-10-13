import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadCatalog: vi.fn(),
  loadAiConfig: vi.fn(),
  generateText: vi.fn(),
  logAiUsage: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: Error) =>
    Response.json({ error: err.message }, { status: 403 }),
  ),
}))
vi.mock('@/lib/automations/generator/catalog', () => ({ loadGeneratorCatalog: mocks.loadCatalog }))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: mocks.loadAiConfig }))
vi.mock('@/lib/ai/generate', () => ({ generateText: mocks.generateText }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: mocks.logAiUsage }))
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: vi.fn(() => ({ name: 'admin' })) }))

import { AiError } from '@/lib/ai/types'
import { __resetRateLimitForTests } from '@/lib/rate-limit'
import type { GeneratorCatalog } from '@/lib/automations/generator/types'
import { GET, POST } from './route'

const COKE = '11111111-1111-4111-8111-111111111111'
const FAQ_FLOW = '9907b409-dd92-4db0-a842-66f3d4e34de1'

const catalog: GeneratorCatalog = {
  campaigns: [{ id: COKE, name: 'Coca-Cola Summer Competition', code: 'COKE', keyword: 'WINCOKE', status: 'active', client_name: 'Coca-Cola' }],
  flows: [{ id: FAQ_FLOW, name: 'FAQ bot', status: 'active', trigger_type: 'keyword', trigger_config: { keywords: ['faq'] } }],
  tags: [],
  templates: [],
  automations: [],
}

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
}

const aiConfig = { provider: 'openai', model: 'gpt-test', apiKey: 'sk-secret-test' }

function post(body: unknown) {
  return POST(new Request('http://localhost/api/automations/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  __resetRateLimitForTests()
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.requireRole.mockResolvedValue(context)
  mocks.loadCatalog.mockResolvedValue(catalog)
  mocks.loadAiConfig.mockResolvedValue(null)
})

describe('POST /api/automations/generate', () => {
  it('requires the agent role and generates nothing for viewers', async () => {
    mocks.requireRole.mockRejectedValue(new Error("This action requires the 'agent' role or higher"))
    const res = await post({ script: 'Send message: hi', campaign_id: null })
    expect(res.status).toBe(403)
    expect(mocks.requireRole).toHaveBeenCalledWith('agent')
    expect(mocks.loadCatalog).not.toHaveBeenCalled()
  })

  it('loads the catalog through the caller\'s RLS-scoped client', async () => {
    await post({ script: 'Send message: hi', campaign_id: null })
    expect(mocks.loadCatalog).toHaveBeenCalledWith(context.supabase)
  })

  it('falls back to the built-in parser when AI is not set up', async () => {
    const res = await post({ script: 'Trigger: keyword WINCOKE\nSend message: Welcome!', name: 'Coke', campaign_id: COKE })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('rules')
    expect(body.automation.name).toBe('Coke')
    expect(body.automation.steps.map((s: { step_type: string }) => s.step_type)).toEqual(['campaign_add_entry', 'send_message'])
    expect(body.warnings[0].message).toContain('AI isn\'t set up')
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('uses the AI provider server-side and maps refs back to real ids', async () => {
    mocks.loadAiConfig.mockResolvedValue(aiConfig)
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        trigger: { type: 'keyword_match', keywords: ['help'] },
        steps: [{ type: 'send_message', text: 'Let me hand you over' }, { type: 'start_flow', flow_id: 'F1' }],
      }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    const res = await post({ script: 'When someone says help, hand them to the FAQ bot', campaign_id: null })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.source).toBe('ai')
    expect(body.automation.steps[1].step_config.flow_id).toBe(FAQ_FLOW)
    expect(body.issues).toEqual([])

    const call = mocks.generateText.mock.calls[0][0]
    expect(call.systemPrompt).toContain('F1: "FAQ bot"')
    expect(call.systemPrompt).not.toContain(FAQ_FLOW)
    expect(JSON.stringify(body)).not.toContain('sk-secret-test')
    expect(mocks.logAiUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: 'automation_generate' }))
  })

  it('returns a clear error and offers the built-in parser when AI fails', async () => {
    mocks.loadAiConfig.mockResolvedValue(aiConfig)
    mocks.generateText.mockRejectedValue(new AiError('The AI provider timed out.', { code: 'timeout', status: 504 }))
    const res = await post({ script: 'Send message: hi', campaign_id: null })
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'The AI provider timed out.', code: 'timeout', fallback: 'rules' })
  })

  it('treats unusable AI output as an error rather than guessing', async () => {
    mocks.loadAiConfig.mockResolvedValue(aiConfig)
    mocks.generateText.mockResolvedValue({ text: 'I cannot do that', usage: null })
    const res = await post({ script: 'Send message: hi', campaign_id: null })
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('invalid_output')
  })

  it('skips AI entirely in rules mode', async () => {
    mocks.loadAiConfig.mockResolvedValue(aiConfig)
    const res = await post({ script: 'Send message: hi', campaign_id: null, mode: 'rules' })
    expect((await res.json()).source).toBe('rules')
    expect(mocks.loadAiConfig).not.toHaveBeenCalled()
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('rejects a campaign from outside the caller\'s account', async () => {
    const res = await post({ script: 'Send message: hi', campaign_id: '99999999-9999-4999-8999-999999999999' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('campaign_not_found')
  })

  it('rejects empty and oversized scripts', async () => {
    expect((await post({ script: '   ', campaign_id: null })).status).toBe(400)
    expect((await post({ script: 'x'.repeat(20_001), campaign_id: null })).status).toBe(400)
  })

  it('is rate limited per user', async () => {
    for (let i = 0; i < 10; i++) await post({ script: 'Send message: hi', campaign_id: null })
    expect((await post({ script: 'Send message: hi', campaign_id: null })).status).toBe(429)
  })
})

describe('GET /api/automations/generate', () => {
  it('reports AI availability without exposing the key', async () => {
    mocks.loadAiConfig.mockResolvedValue(aiConfig)
    const res = await GET()
    const body = await res.json()
    expect(body.ai).toEqual({ configured: true, provider: 'openai', model: 'gpt-test' })
    expect(body.campaigns[0].client_name).toBe('Coca-Cola')
    expect(JSON.stringify(body)).not.toContain('sk-secret-test')
  })
})
