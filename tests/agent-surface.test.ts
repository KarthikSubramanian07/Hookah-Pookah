import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAgentArtifacts } from '../scripts/postbuild.ts'
import { HOME_PAGE, TRUST_PAGES, organizationJsonLd, renderLlmsTxt } from '../scripts/site/content.ts'

const viteShell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>old</title>
    <meta name="description" content="old" />
    <link rel="canonical" href="https://hookah-pookah.pages.dev/" />
    <meta property="og:url" content="https://hookah-pookah.pages.dev/" />
    <meta property="og:title" content="old" />
    <meta property="og:description" content="old" />
    <meta name="twitter:title" content="old" />
    <meta name="twitter:description" content="old" />
    <script type="application/ld+json">{}</script>
    <script type="module" crossorigin src="/assets/index-test.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-test.css">
  </head>
  <body>
    <div id="root"></div>
    <noscript><p>old</p></noscript>
  </body>
</html>
`

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('agent surface artifacts', () => {
  it('emits HTML content, markdown twins, trust pages, 404 and llms.txt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hp-agent-'))
    try {
      writeFileSync(join(dir, 'index.html'), viteShell)
      writeAgentArtifacts(dir, viteShell, '2026-10-08')

      const home = readFileSync(join(dir, 'index.html'), 'utf8')
      expect(home).toContain('<h1>Hookah Pookah poker calculator</h1>')
      expect(visibleText(home).length).toBeGreaterThan(500)
      expect(home).toContain('"@type": "Organization"')
      expect(home).toContain('contactPoint')
      expect(home).toContain('PostalAddress')
      expect(home).toContain('rel="alternate" type="text/markdown"')

      const homeMd = readFileSync(join(dir, 'index.md'), 'utf8')
      expect(homeMd.startsWith('# Hookah Pookah')).toBe(true)
      expect(homeMd.length).toBeGreaterThan(200)

      for (const page of TRUST_PAGES) {
        const html = readFileSync(join(dir, `${page.path.slice(1)}.html`), 'utf8')
        expect(visibleText(html).length).toBeGreaterThan(500)
        const md = readFileSync(join(dir, `${page.path.slice(1)}.md`), 'utf8')
        expect(md.length).toBeGreaterThan(200)
      }

      const notFound = readFileSync(join(dir, '404.html'), 'utf8')
      expect(notFound).toContain('Page not found')
      expect(readFileSync(join(dir, '404.md'), 'utf8').length).toBeGreaterThan(20)

      const llms = readFileSync(join(dir, 'llms.txt'), 'utf8')
      expect(llms).toContain('## When to use this')
      expect(llms).toContain('## Instructions')
      expect(llms).toBe(renderLlmsTxt())

      const sitemap = readFileSync(join(dir, 'sitemap.xml'), 'utf8')
      expect(sitemap).toContain('/about')
      expect(sitemap).toContain('/contact')
      expect(sitemap).toContain('/privacy')

      expect(HOME_PAGE.markdown.length).toBeGreaterThan(200)
      const org = organizationJsonLd()
      expect(org.contactPoint).toMatchObject({ contactType: 'customer support' })
      expect(org.address).toMatchObject({ '@type': 'PostalAddress' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
