import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /auth/callback
 *
 * Landing point for Supabase email links (password recovery today;
 * any `redirectTo` that points here). Turns the link into a session
 * cookie, then sends the user on to `next`.
 *
 * Handles both link shapes Supabase can send:
 *   - `?code=…`                  PKCE flow (the @supabase/ssr default)
 *   - `?token_hash=…&type=…`     custom email templates using TokenHash
 *
 * `next` is restricted to a same-origin path so the link can't be
 * turned into an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNextPath(searchParams.get('next'))

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, origin))
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return NextResponse.redirect(new URL(next, origin))
  }

  // Expired / already-used / malformed link.
  return NextResponse.redirect(new URL('/forgot-password?error=link_invalid', origin))
}

function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/dashboard'
  }
  return next
}
