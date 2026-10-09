import {
  HOME_PAGE,
  SITE,
  STATIC_PAGE_STYLE,
  jsonLdScript,
  type PageCopy,
} from './content.ts'

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function replaceMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`)
  if (!re.test(html)) return html
  return html.replace(re, `$1${escapeAttr(value)}$2`)
}

export function applyPageMeta(template: string, page: PageCopy): string {
  const url = page.path === '/' ? `${SITE}/` : `${SITE}${page.path}`
  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(page.title)}</title>`)
  html = replaceMeta(html, 'name', 'description', page.description)
  html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/, `$1${escapeAttr(url)}$2`)
  html = replaceMeta(html, 'property', 'og:url', url)
  html = replaceMeta(html, 'property', 'og:title', page.ogTitle)
  html = replaceMeta(html, 'property', 'og:description', page.description)
  html = replaceMeta(html, 'name', 'twitter:title', page.ogTitle)
  html = replaceMeta(html, 'name', 'twitter:description', page.description)
  return html
}

/** Injects Organization + WebApplication JSON-LD and a Markdown alternate link. */
export function applyMachineMeta(html: string, page: PageCopy): string {
  const mdHref = page.path === '/' ? '/index.md' : `${page.path}.md`
  let out = html
  if (!out.includes('rel="alternate" type="text/markdown"')) {
    out = out.replace(
      /<link\s+rel="canonical"[^>]*>/,
      (m) => `${m}\n    <link rel="alternate" type="text/markdown" href="${escapeAttr(mdHref)}" />`,
    )
  }
  const script = `    <script type="application/ld+json">\n${jsonLdScript()}\n    </script>`
  if (out.includes('application/ld+json')) {
    out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, script.trim())
  } else {
    out = out.replace('</head>', `${script}\n  </head>`)
  }
  return out
}

/** Puts prerender copy inside #root for no-JS / non-executing crawlers. */
export function injectPrerender(html: string, body: string): string {
  if (/<div id="root">[\s\S]*?<\/div>/.test(html)) {
    return html.replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">\n${body}\n    </div>`)
  }
  return html.replace(/<div id="root"><\/div>/, `<div id="root">\n${body}\n    </div>`)
}

export function renderStaticDocument(page: PageCopy): string {
  const url = `${SITE}${page.path === '/404' ? '/404' : page.path}`
  const mdHref = page.path === '/404' ? '/404.md' : page.path === '/' ? '/index.md' : `${page.path}.md`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeAttr(page.title)}</title>
    <meta name="description" content="${escapeAttr(page.description)}" />
    <link rel="canonical" href="${escapeAttr(url)}" />
    <link rel="alternate" type="text/markdown" href="${escapeAttr(mdHref)}" />
    <meta name="theme-color" content="#11151c" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Hookah Pookah" />
    <meta property="og:title" content="${escapeAttr(page.ogTitle)}" />
    <meta property="og:description" content="${escapeAttr(page.description)}" />
    <meta property="og:url" content="${escapeAttr(url)}" />
    <meta property="og:image" content="${SITE}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(page.ogTitle)}" />
    <meta name="twitter:description" content="${escapeAttr(page.description)}" />
    <meta name="twitter:image" content="${SITE}/og.png" />
    <script type="application/ld+json">
${jsonLdScript()}
    </script>
    <style>${STATIC_PAGE_STYLE}</style>
  </head>
  <body>
    <nav class="site-nav" aria-label="Site">
      <a class="brand" href="/">Hookah Pookah</a>
      <a href="/holdem">Hold'em</a>
      <a href="/short-deck">Short Deck</a>
      <a href="/plo">PLO4</a>
      <a href="/plo5">PLO5</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy</a>
    </nav>
    ${page.htmlBody}
  </body>
</html>
`
}

export function homepageFromTemplate(viteIndexHtml: string): string {
  let html = applyPageMeta(viteIndexHtml, HOME_PAGE)
  html = applyMachineMeta(html, HOME_PAGE)
  html = injectPrerender(html, HOME_PAGE.htmlBody)
  // Keep a noscript mirror for browsers that ignore #root fallbacks.
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>\n${HOME_PAGE.htmlBody}\n    </noscript>`)
  return html
}
