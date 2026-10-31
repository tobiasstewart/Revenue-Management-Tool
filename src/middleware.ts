import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, makeNonce } from '@/lib/csp'

// Fully public routes (no session required)
const PUBLIC_PATHS = ['/login', '/auth/confirm']
// Always passthrough — the login route handler is what CREATES the session
const API_AUTH_PREFIX = '/api/auth'

export async function middleware(request: NextRequest) {
  // Link prefetches skip the auth roundtrip; the real navigation is still checked.
  if (
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch'
  ) {
    return NextResponse.next({ request })
  }

  const nonce = makeNonce()
  const csp = buildCsp(nonce, {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    isDev: process.env.NODE_ENV !== 'production',
    isPreview: process.env.VERCEL_ENV === 'preview',
  })

  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('Content-Security-Policy', csp)
    return res
  }
  const nextResponse = () => {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', nonce)
    requestHeaders.set('Content-Security-Policy', csp)
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  }
  const redirect = (path: string, search?: Record<string, string>) => {
    const url = new URL(path, request.url)
    for (const [k, v] of Object.entries(search ?? {})) url.searchParams.set(k, v)
    return withCsp(NextResponse.redirect(url))
  }

  // Mutable response so Supabase can refresh session cookies
  let supabaseResponse = nextResponse()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = nextResponse()
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: always getUser() (validates the JWT), never getSession()
  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  if (pathname.startsWith(API_AUTH_PREFIX)) return supabaseResponse

  if (PUBLIC_PATHS.includes(pathname)) {
    if (pathname === '/login' && user) return redirect('/')
    return supabaseResponse
  }

  if (!user) return redirect('/login', { next: pathname })

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
