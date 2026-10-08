/**
 * Post-build SEO and agent-readiness pass over dist/:
 *  - HTML + Markdown twins for home, game routes, trust pages and 404
 *  - llms.txt with when-to-use guidance
 *  - sitemap.xml
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VARIANT_TITLES } from '../src/state/seo.ts'
import { prefersMarkdown, markdownPathFor } from './site/accept.ts'
import {
  HOME_PAGE,
  NOT_FOUND_PAGE,
  SITE,
  TRUST_PAGES,
  renderLlmsTxt,
  variantMarkdown,
  type PageCopy,
} from './site/content.ts'
import { applyMachineMeta, applyPageMeta, homepageFromTemplate, injectPrerender, renderStaticDocument } from './site/html.ts'

export { prefersMarkdown, markdownPathFor, SITE, HOME_PAGE, TRUST_PAGES, NOT_FOUND_PAGE, renderLlmsTxt }

interface GamePage {
  path: string
  title: string
  description: string
  ogTitle: string
  name: string
  blurb: string
}

export const GAME_PAGES: GamePage[] = [
  {
    path: '/holdem',
    title: VARIANT_TITLES.holdem,
    description:
      "Texas Hold'em equity calculator with exact enumeration, weighted ranges, hand chances and every turn and river card. Free, fast and verified against OMPEval.",
    ogTitle: "Texas Hold'em odds, exact whenever the math allows",
    name: "Hookah Pookah Texas Hold'em odds calculator",
    blurb:
      "Calculate Texas Hold'em equity, win and tie odds, hand chances and next-card odds with exact enumeration or Monte Carlo confidence intervals.",
  },
  {
    path: '/short-deck',
    title: VARIANT_TITLES.shortdeck,
    description:
      "Short Deck Hold'em equity calculator for Triton and classic rules: flush beats full house, A-6-7-8-9 straights, exact equities, ranges and next-card odds.",
    ogTitle: 'Short Deck odds under Triton or classic rules',
    name: 'Hookah Pookah Short Deck odds calculator',
    blurb:
      'Calculate Short Deck (6+) Hold\'em equity under Triton or classic rankings, including ranges, hand chances and next-card odds.',
  },
  {
    path: '/plo',
    title: VARIANT_TITLES.omaha4,
    description:
      'Pot Limit Omaha (PLO4) equity calculator. Exact multiway equities, hand chances using exactly two hole cards, and every next card, computed in your browser.',
    ogTitle: 'PLO4 equity, exact in milliseconds',
    name: 'Hookah Pookah PLO4 equity calculator',
    blurb: 'Calculate Pot Limit Omaha (PLO4) equity with exact two-hole-plus-three-board evaluation, hand chances and next-card odds.',
  },
  {
    path: '/plo5',
    title: VARIANT_TITLES.omaha5,
    description: 'Five card Pot Limit Omaha (PLO5) equity calculator with exact enumeration, Monte Carlo confidence intervals, hand chances and next-card equity.',
    ogTitle: 'PLO5 equity, exact whenever the math allows',
    name: 'Hookah Pookah PLO5 equity calculator',
    blurb: 'Calculate five-card Pot Limit Omaha (PLO5) equity with exact enumeration when feasible and Monte Carlo intervals otherwise.',
  },
]

function gameCopy(page: GamePage): PageCopy {
  const markdown = variantMarkdown(page.name, page.blurb)
  const htmlBody = `
<main class="prerender">
  <h1>${page.name}</h1>
  <p>${page.blurb} Hookah Pookah runs entirely in your browser and labels every result as exact or Monte Carlo with a confidence interval.</p>
  <h2>Open this calculator</h2>
  <p>This page loads the interactive ${page.name.replace('Hookah Pookah ', '')}. Enable JavaScript to enter cards, ranges and boards.</p>
  <h2>More from Hookah Pookah</h2>
  <p>
    <a href="/">All games</a> ·
    <a href="/about">About</a> ·
    <a href="/contact">Contact</a> ·
    <a href="/privacy">Privacy</a> ·
    <a href="/llms.txt">llms.txt</a>
  </p>
</main>
`.trim()
  return {
    path: page.path,
    title: page.title,
    description: page.description,
    ogTitle: `Hookah Pookah · ${page.ogTitle}`,
    markdown,
    htmlBody,
  }
}

export function renderSitemap(date: string): string {
  const urls = ['/', ...GAME_PAGES.map((p) => p.path), ...TRUST_PAGES.map((p) => p.path)]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${SITE}${u === '/' ? '/' : u}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>${u === '/' ? '1.0' : u.startsWith('/about') || u.startsWith('/contact') || u.startsWith('/privacy') ? '0.6' : '0.8'}</priority></url>`,
  )
  .join('\n')}
</urlset>
`
}

function writeText(file: string, body: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
}

export function writeAgentArtifacts(distDir: string, viteIndexHtml: string, date = new Date().toISOString().slice(0, 10)) {
  const home = homepageFromTemplate(viteIndexHtml)
  writeText(join(distDir, 'index.html'), home)
  writeText(join(distDir, 'index.md'), HOME_PAGE.markdown)

  for (const game of GAME_PAGES) {
    const copy = gameCopy(game)
    let html = applyPageMeta(viteIndexHtml, copy)
    html = applyMachineMeta(html, copy)
    html = injectPrerender(html, copy.htmlBody)
    html = html.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>\n${copy.htmlBody}\n    </noscript>`)
    writeText(join(distDir, `${game.path.slice(1)}.html`), html)
    writeText(join(distDir, `${game.path.slice(1)}.md`), copy.markdown)
  }

  for (const page of TRUST_PAGES) {
    writeText(join(distDir, `${page.path.slice(1)}.html`), renderStaticDocument(page))
    writeText(join(distDir, `${page.path.slice(1)}.md`), page.markdown)
  }

  writeText(join(distDir, '404.html'), renderStaticDocument(NOT_FOUND_PAGE))
  writeText(join(distDir, '404.md'), NOT_FOUND_PAGE.markdown)
  writeText(join(distDir, 'llms.txt'), renderLlmsTxt())
  writeText(join(distDir, 'sitemap.xml'), renderSitemap(date))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url))
  const template = readFileSync(`${dist}index.html`, 'utf8')
  writeAgentArtifacts(dist, template)
  console.log(`postbuild: wrote game routes, trust pages, 404, markdown twins, llms.txt and sitemap.xml`)
}
