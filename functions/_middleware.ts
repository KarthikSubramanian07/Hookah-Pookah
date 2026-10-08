/**
 * Cloudflare Pages middleware: Markdown content negotiation + agent-friendly 404 bodies.
 * Static HTML/Markdown twins are emitted by scripts/postbuild.ts.
 */

import { markdownPathFor, prefersMarkdown } from '../scripts/site/accept.ts'
import { NOT_FOUND_PAGE } from '../scripts/site/content.ts'

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
}

function withVaryAccept(headers: Headers): Headers {
  const next = new Headers(headers)
  const vary = next.get('Vary')
  if (!vary) next.set('Vary', 'Accept')
  else if (!/\bAccept\b/i.test(vary)) next.set('Vary', `${vary}, Accept`)
  return next
}

function markdownResponse(body: string, status = 200): Response {
  const headers = withVaryAccept(new Headers(SECURITY_HEADERS))
  headers.set('Content-Type', 'text/markdown; charset=utf-8')
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
  return new Response(body, { status, headers })
}

function isAssetPath(pathname: string): boolean {
  return /\.(?:js|css|png|svg|ico|webp|woff2?|map|txt|xml|webmanifest|json)$/i.test(pathname)
}

type PagesContext = {
  request: Request
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, next } = context
  const url = new URL(request.url)
  const wantMarkdown = prefersMarkdown(request.headers.get('Accept'))
  const mutable = request.method === 'GET' || request.method === 'HEAD'

  if (!wantMarkdown || !mutable) {
    const res = await next()
    const headers = withVaryAccept(res.headers)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }

  if (isAssetPath(url.pathname) && !url.pathname.endsWith('.md')) {
    const res = await next()
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: withVaryAccept(res.headers) })
  }

  const mdPath = markdownPathFor(url.pathname)
  if (!mdPath) return markdownResponse(NOT_FOUND_PAGE.markdown, 404)

  const mdUrl = new URL(url)
  mdUrl.pathname = mdPath
  const mdRes = await next(new Request(mdUrl.toString(), request))
  const type = mdRes.headers.get('content-type') || ''

  if (mdRes.ok && !/html/i.test(type)) {
    if (request.method === 'HEAD') {
      const headers = withVaryAccept(new Headers(SECURITY_HEADERS))
      headers.set('Content-Type', 'text/markdown; charset=utf-8')
      return new Response(null, { status: 200, headers })
    }
    const body = await mdRes.text()
    if (body.trim().length > 0) return markdownResponse(body, 200)
  }

  return markdownResponse(NOT_FOUND_PAGE.markdown, 404)
}
