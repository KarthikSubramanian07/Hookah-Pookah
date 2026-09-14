/**
 * Post-build SEO pass over dist/:
 *  - one prerendered HTML entry per game (/holdem, /short-deck, /plo, /plo5) with its own title,
 *    description, canonical URL and social tags, so each clean route is indexable on its own
 *  - sitemap.xml
 * The app itself hydrates the same bundle on every route.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VARIANT_TITLES } from '../src/state/seo.ts'

export const SITE = 'https://hookah-pookah.pages.dev'

interface Page {
  path: string
  title: string
  description: string
  ogTitle: string
}

export const PAGES: Page[] = [
  {
    path: '/holdem',
    title: VARIANT_TITLES.holdem,
    description:
      "Texas Hold'em equity calculator with exact enumeration, weighted ranges, hand chances and every turn and river card. Free, fast and verified against OMPEval.",
    ogTitle: "Texas Hold'em odds, exact whenever the math allows",
  },
  {
    path: '/short-deck',
    title: VARIANT_TITLES.shortdeck,
    description:
      'Short Deck Hold\'em equity calculator for Triton and classic rules: flush beats full house, A-6-7-8-9 straights, exact equities, ranges and next-card odds.',
    ogTitle: 'Short Deck odds under Triton or classic rules',
  },
  {
    path: '/plo',
    title: VARIANT_TITLES.omaha4,
    description:
      'Pot Limit Omaha (PLO4) equity calculator. Exact multiway equities, hand chances using exactly two hole cards, and every next card, computed in your browser.',
    ogTitle: 'PLO4 equity, exact in milliseconds',
  },
  {
    path: '/plo5',
    title: VARIANT_TITLES.omaha5,
    description: 'Five card Pot Limit Omaha (PLO5) equity calculator with exact enumeration, Monte Carlo confidence intervals, hand chances and next-card equity.',
    ogTitle: 'PLO5 equity, exact whenever the math allows',
  },
]

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function renderPage(template: string, page: Page): string {
  const url = `${SITE}${page.path}`
  const replaceMeta = (html: string, attr: 'name' | 'property', key: string, value: string) =>
    html.replace(new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`), `$1${escapeAttr(value)}$2`)
  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(page.title)}</title>`)
  html = replaceMeta(html, 'name', 'description', page.description)
  html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${url}$2`)
  html = replaceMeta(html, 'property', 'og:url', url)
  html = replaceMeta(html, 'property', 'og:title', `Hookah Pookah · ${page.ogTitle}`)
  html = replaceMeta(html, 'property', 'og:description', page.description)
  html = replaceMeta(html, 'name', 'twitter:title', `Hookah Pookah · ${page.ogTitle}`)
  html = replaceMeta(html, 'name', 'twitter:description', page.description)
  return html
}

export function renderSitemap(date: string): string {
  const urls = ['/', ...PAGES.map((p) => p.path)]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>${u === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url))
  const template = readFileSync(`${dist}index.html`, 'utf8')
  for (const page of PAGES) {
    mkdirSync(`${dist}${page.path.slice(1)}`, { recursive: true })
    writeFileSync(`${dist}${page.path.slice(1)}/index.html`, renderPage(template, page))
  }
  writeFileSync(`${dist}sitemap.xml`, renderSitemap(new Date().toISOString().slice(0, 10)))
  console.log(`postbuild: wrote ${PAGES.length} route pages and sitemap.xml`)
}
