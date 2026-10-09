/**
 * RFC 9110 Accept parsing for text/markdown vs text/html negotiation.
 * Picks the highest-q type we can produce; specificity beats wildcards on ties.
 */

export type NegotiatedType = 'markdown' | 'html'

interface AcceptOffer {
  type: string
  q: number
  specificity: number
  index: number
}

const SPECIFICITY: Record<string, number> = {
  'text/markdown': 3,
  'text/html': 3,
  'text/*': 2,
  '*/*': 1,
}

function parsePart(part: string, index: number): AcceptOffer | undefined {
  const [rawType, ...params] = part.split(';').map((s) => s.trim())
  if (!rawType) return undefined
  const type = rawType.toLowerCase()
  let q = 1
  for (const param of params) {
    const match = /^q\s*=\s*([0-9.]+)$/i.exec(param)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value)) q = Math.min(1, Math.max(0, value))
    }
  }
  if (q <= 0) return undefined
  return { type, q, specificity: SPECIFICITY[type] ?? (type.includes('/') ? 3 : 0), index }
}

/** Returns whether Markdown is the best representation we can serve for this Accept header. */
export function prefersMarkdown(acceptHeader: string | null): boolean {
  return negotiate(acceptHeader) === 'markdown'
}

export function negotiate(acceptHeader: string | null): NegotiatedType {
  if (!acceptHeader || !acceptHeader.trim()) return 'html'

  const offers = acceptHeader
    .split(',')
    .map((part, index) => parsePart(part, index))
    .filter((o): o is AcceptOffer => o !== undefined)
    .sort((a, b) => b.q - a.q || b.specificity - a.specificity || a.index - b.index)

  if (!offers.length) return 'html'

  for (const offer of offers) {
    if (offer.type === 'text/markdown') return 'markdown'
    if (offer.type === 'text/html') return 'html'
    if (offer.type === 'text/*' || offer.type === '*/*') return 'html'
  }
  return 'html'
}

/** Maps a request pathname to the static Markdown twin emitted by postbuild. */
export function markdownPathFor(pathname: string): string | undefined {
  const clean = pathname.replace(/\/+$/, '') || '/'
  if (clean.includes('..')) return undefined
  if (clean === '/') return '/index.md'
  if (/\.[a-z0-9]+$/i.test(clean)) {
    if (clean.endsWith('.html')) return `${clean.slice(0, -5)}.md`
    return undefined
  }
  return `${clean}.md`
}
