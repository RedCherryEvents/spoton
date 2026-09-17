import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  campaignsNotReadyResponse,
  isMissingRelationError,
} from '@/lib/campaigns/schema-error'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('campaigns')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingRelationError(error)) return campaignsNotReadyResponse()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ campaigns: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!name || !code) {
      return NextResponse.json({ error: 'name and code are required' }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('campaigns')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        code,
        keyword: typeof body?.keyword === 'string' ? body.keyword.trim() || null : null,
        description: typeof body?.description === 'string' ? body.description.trim() || null : null,
        status: 'draft',
      })
      .select('*')
      .single()
    if (error) {
      if (isMissingRelationError(error)) return campaignsNotReadyResponse()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ campaign: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
