import { expect, test } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 8791)
const origin = `http://127.0.0.1:${PORT}`

async function fetchRaw(path: string, accept: string) {
  const res = await fetch(`${origin}${path}`, { headers: { Accept: accept }, redirect: 'follow' })
  const headers = Object.fromEntries(res.headers.entries())
  const body = await res.text()
  return { status: res.status, headers, body }
}

test.describe('agent HTTP surface', () => {
  test('homepage serves HTML and Markdown with Vary: Accept', async () => {
    const html = await fetchRaw('/', 'text/html')
    expect(html.status).toBe(200)
    expect(html.headers['content-type']).toMatch(/text\/html/)
    expect(html.headers.vary || '').toMatch(/Accept/i)
    expect(html.body).toContain('<h1>Hookah Pookah poker calculator</h1>')
    const text = html.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
    expect(text.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(500)

    const md = await fetchRaw('/', 'text/markdown')
    expect(md.status).toBe(200)
    expect(md.headers['content-type']).toMatch(/text\/markdown/)
    expect(md.headers.vary || '').toMatch(/Accept/i)
    expect(md.body).toMatch(/^# Hookah Pookah/m)
    expect(md.body.length).toBeGreaterThan(200)
  })

  test('unknown paths return real 404 with Markdown body', async () => {
    const md = await fetchRaw('/some-path-that-does-not-exist', 'text/markdown')
    expect(md.status).toBe(404)
    expect(md.headers['content-type']).toMatch(/text\/markdown/)
    expect(md.body.length).toBeGreaterThan(20)
    expect(md.body).toMatch(/llms\.txt|sitemap|not found/i)

    const html = await fetchRaw('/some-path-that-does-not-exist', 'text/html')
    expect(html.status).toBe(404)
    expect(html.body).toMatch(/Page not found/i)
  })

  test('trust pages and llms.txt are substantive', async () => {
    for (const path of ['/about', '/contact', '/privacy']) {
      const page = await fetchRaw(path, 'text/html')
      expect(page.status).toBe(200)
      const text = page.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
      expect(text.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(500)
      expect(page.body).toMatch(/Organization|Hookah Pookah/i)

      const md = await fetchRaw(path, 'text/markdown')
      expect(md.status).toBe(200)
      expect(md.headers['content-type']).toMatch(/text\/markdown/)
    }

    const llms = await fetchRaw('/llms.txt', 'text/plain')
    expect(llms.status).toBe(200)
    expect(llms.body).toContain('## When to use this')
    expect(llms.body).toContain('Hookah Pookah')
  })
})
