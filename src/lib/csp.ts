/**
 * Content Security Policy, built per request by the middleware.
 *
 * A per-request nonce is handed to Next through the request's own
 * Content-Security-Policy header; the App Router stamps it on every script it
 * emits, so `script-src` can be nonce + 'strict-dynamic' with no
 * 'unsafe-inline'. The session lives in JavaScript-readable cookies
 * (@supabase/ssr), so XSS = session theft — this is what keeps injected script
 * inert. Nonces require per-request rendering, which is why the root layout is
 * `force-dynamic`.
 *
 * Adding an external script, CDN or font means editing this function.
 */
export function buildCsp(
  nonce: string,
  env: { supabaseUrl?: string; isDev?: boolean; isPreview?: boolean } = {}
): string {
  const supabaseUrl = env.supabaseUrl ?? ''
  const supabaseWs = supabaseUrl.replace(/^http/, 'ws')

  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`]
  const connectSrc = [`'self'`, supabaseUrl, supabaseWs]
  const frameSrc = [`'none'`]
  if (env.isDev) {
    scriptSrc.push(`'unsafe-eval'`)
    connectSrc.push('ws:', 'wss:')
  }
  if (env.isPreview) {
    scriptSrc.push('https://vercel.live')
    connectSrc.push('https://vercel.live', 'wss://ws-us3.pusher.com')
    frameSrc.splice(0, 1, 'https://vercel.live')
  }

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc.filter(Boolean).join(' ')}`,
    `worker-src 'self' blob:`,
    `frame-src ${frameSrc.join(' ')}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ')
}

export function makeNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
