import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError, type AiConfig } from '@/lib/ai/types'
import { loadGeneratorCatalog } from '@/lib/automations/generator/catalog'
import { normalizeDraft } from '@/lib/automations/generator/normalize'
import { parseScript } from '@/lib/automations/generator/script-parser'
import {
  aiUserMessage,
  buildGeneratorPrompt,
  GENERATOR_MAX_TOKENS,
  parseAiDraft,
} from '@/lib/automations/generator/ai'
import type { DraftSpec, GenerateResult, GeneratorSource } from '@/lib/automations/generator/types'

const MAX_SCRIPT_LENGTH = 20_000
const AI_TIMEOUT_MS = 60_000

async function loadConfigSafely(
  supabase: Parameters<typeof loadAiConfig>[0],
  accountId: string,
): Promise<AiConfig | null> {
  try {
    return await loadAiConfig(supabase, accountId)
  } catch (err) {
    console.error('[automations/generate] loadAiConfig error:', err)
    return null
  }
}

/**
 * GET /api/automations/generate  (agent+)
 *
 * What the script form and review need: the account's campaigns (with
 * client), flows and tags for the live summary, and whether AI
 * generation is available. Never returns key material.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [catalog, config] = await Promise.all([
      loadGeneratorCatalog(supabase),
      loadConfigSafely(supabase, accountId),
    ])
    return NextResponse.json({
      campaigns: catalog.campaigns,
      flows: catalog.flows.map(({ id, name, status }) => ({ id, name, status })),
      tags: catalog.tags,
      ai: config ? { configured: true, provider: config.provider, model: config.model } : { configured: false },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/automations/generate  (agent+)
 *
 * Body: { script, name, campaign_id: string | null, mode?: 'auto' | 'rules' }
 * Returns: GenerateResult, a draft in the automations schema plus
 * warnings, validation issues and a plain-language summary.
 *
 * Read-only: nothing is saved, activated or sent. The review screen
 * saves the (edited) draft through POST /api/automations like any other.
 * `auto` uses the account's AI provider when one is set up, otherwise
 * the built-in line parser; `rules` always uses the built-in parser.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`automation-generate:${userId}`, RATE_LIMITS.automationGenerate)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const script = body && typeof body.script === 'string' ? body.script : ''
    const name = body && typeof body.name === 'string' ? body.name.slice(0, 200) : ''
    const campaignId = body && typeof body.campaign_id === 'string' && body.campaign_id ? body.campaign_id : null
    const mode = body?.mode === 'rules' ? 'rules' : 'auto'

    if (!script.trim()) {
      return NextResponse.json({ error: 'Paste a script to generate from.', code: 'script_required' }, { status: 400 })
    }
    if (script.length > MAX_SCRIPT_LENGTH) {
      return NextResponse.json(
        { error: `Scripts can be at most ${MAX_SCRIPT_LENGTH.toLocaleString('en-US')} characters.`, code: 'script_too_long' },
        { status: 400 },
      )
    }

    const catalog = await loadGeneratorCatalog(supabase)
    // RLS already scoped the catalog to this account, so a campaign the
    // caller can't see is simply "not found".
    if (campaignId && !catalog.campaigns.some((c) => c.id === campaignId)) {
      return NextResponse.json({ error: 'Campaign not found.', code: 'campaign_not_found' }, { status: 400 })
    }

    const config = mode === 'auto' ? await loadConfigSafely(supabase, accountId) : null

    let spec: DraftSpec
    let source: GeneratorSource
    if (config) {
      const accountLimit = checkRateLimit(`ai-draft-acct:${accountId}`, RATE_LIMITS.aiDraftAccount)
      if (!accountLimit.success) return rateLimitResponse(accountLimit)

      const { text, usage } = await generateText({
        config,
        systemPrompt: buildGeneratorPrompt(catalog, campaignId),
        messages: [{ role: 'user', content: aiUserMessage(name, script) }],
        maxTokens: GENERATOR_MAX_TOKENS,
        timeoutMs: AI_TIMEOUT_MS,
      })
      try {
        void logAiUsage(supabaseAdmin(), {
          accountId,
          conversationId: null,
          mode: 'automation_generate',
          provider: config.provider,
          model: config.model,
          usage,
        })
      } catch (logErr) {
        console.error('[automations/generate] usage log skipped:', logErr)
      }
      spec = parseAiDraft(text)
      source = 'ai'
    } else {
      spec = parseScript(script)
      source = 'rules'
      if (mode === 'auto') {
        spec.notes.unshift({
          level: 'info',
          message: 'AI isn\'t set up for this account, so the built-in parser was used. It understands one instruction per line (see the examples).',
        })
      }
    }

    const result: GenerateResult = {
      ...normalizeDraft(spec, catalog, { name, campaignId }),
      source,
    }
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AiError) {
      // The script lives in the browser; it is never lost on failure.
      return NextResponse.json(
        { error: err.message, code: err.code, fallback: 'rules' },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
