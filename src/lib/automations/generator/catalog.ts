import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratorCatalog } from './types'

function clientName(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null
  const v = (settings as Record<string, unknown>).client_name
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Everything a generated automation may reference. Pass the caller's
 * RLS-scoped client: every query is limited to their account, so the
 * generator can only ever resolve records the caller can already see.
 * Archived campaigns and flows are left out.
 */
export async function loadGeneratorCatalog(supabase: SupabaseClient): Promise<GeneratorCatalog> {
  const [campaignsRes, flowsRes, tagsRes, templatesRes, automationsRes] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, name, code, keyword, status, settings')
      .neq('status', 'archived')
      .order('name'),
    supabase
      .from('flows')
      .select('id, name, status, trigger_type, trigger_config')
      .neq('status', 'archived')
      .order('name'),
    supabase.from('tags').select('id, name').order('name'),
    supabase
      .from('message_templates')
      .select('name, language')
      .eq('status', 'APPROVED')
      .order('name'),
    supabase
      .from('automations')
      .select('id, name, is_active, trigger_type, trigger_config')
      .order('name'),
  ])

  const failed = [campaignsRes, flowsRes, tagsRes, templatesRes, automationsRes].find((r) => r.error)
  if (failed?.error) throw failed.error

  return {
    campaigns: (campaignsRes.data ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      code: c.code as string,
      keyword: (c.keyword as string | null) ?? null,
      status: c.status as string,
      client_name: clientName(c.settings),
    })),
    flows: (flowsRes.data ?? []).map((f) => ({
      id: f.id as string,
      name: f.name as string,
      status: f.status as string,
      trigger_type: f.trigger_type as string,
      trigger_config: (f.trigger_config as Record<string, unknown>) ?? {},
    })),
    tags: (tagsRes.data ?? []) as { id: string; name: string }[],
    templates: (templatesRes.data ?? []).map((t) => ({
      name: t.name as string,
      language: (t.language as string) || 'en_US',
    })),
    automations: (automationsRes.data ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      is_active: !!a.is_active,
      trigger_type: a.trigger_type as string,
      trigger_config: (a.trigger_config as Record<string, unknown>) ?? {},
    })),
  }
}
