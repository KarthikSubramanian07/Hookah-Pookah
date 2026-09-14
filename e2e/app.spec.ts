import { AxeBuilder } from '@axe-core/playwright'
import { type Page, expect, test } from '@playwright/test'

const heroEquity = (page: Page) => page.getByRole('listitem').filter({ hasText: 'Hero' }).locator('.equity-bar-value')
const summaryValue = (page: Page, name: string) => page.locator('.equity-bar').filter({ hasText: name }).locator('.equity-bar-value')
const methodBadge = (page: Page) => page.locator('.method-badge')

async function waitDone(page: Page) {
  await expect(page.locator('.method')).toHaveAttribute('data-state', 'done', { timeout: 45_000 })
}

test.describe('calculator', () => {
  test('default spot resolves exactly', async ({ page }) => {
    await page.goto('/holdem')
    await waitDone(page)
    await expect(methodBadge(page)).toHaveText('Exact')
    await expect(summaryValue(page, 'Hero')).toHaveText('41.90%')
    await expect(summaryValue(page, 'Player 2')).toHaveText('58.10%')
  })

  test('quick spot entry loads a matchup and updates the URL', async ({ page }) => {
    await page.goto('/holdem')
    await page.keyboard.press('/')
    await page.keyboard.type('AsAh vs KsKh')
    await page.keyboard.press('Enter')
    await waitDone(page)
    await expect(summaryValue(page, 'Hero')).toHaveText('82.64%')
    await expect(page).toHaveURL(/\/holdem\?p=AsAh&p=KsKh$/)
    await page.locator('#quick').fill('AhAh vs KK')
    await page.locator('#quick').press('Enter')
    await expect(page.locator('#quick-help')).toHaveText(/Ah appears twice/)
  })

  test('shared URLs restore the full spot', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=r:QQ%2B,AKs&b=Qh7h2c&d=3s')
    await waitDone(page)
    await expect(page.locator('#range-1')).toHaveValue('QQ+,AKs')
    await expect(page.getByRole('button', { name: /Flop card 1: Queen of hearts/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Dead card 1: Three of spades/ })).toBeVisible()
    await expect(methodBadge(page)).toHaveText('Exact')
  })

  test('cards can be typed straight into slots and moved between owners', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=QsQd')
    await waitDone(page)
    const slot = page.getByRole('button', { name: /^Hero card 1:/ })
    await slot.focus()
    await page.keyboard.press('Backspace')
    await expect(slot).toHaveAccessibleName(/empty/)
    await page.keyboard.type('7c')
    await expect(slot).toHaveAccessibleName(/Seven of clubs/)
    await waitDone(page)
    await expect(page).toHaveURL(/p=7cKh/)

    // Picking a card that player 2 holds moves it to the hero.
    await slot.click()
    const picker = page.getByRole('dialog', { name: /Pick a card/ })
    await expect(picker).toBeVisible()
    await picker.getByRole('gridcell', { name: /Queen of spades, in use by P2/ }).click()
    await expect(page.getByRole('button', { name: /^Player 2 card 1: empty/ })).toBeVisible()
    await expect(page).toHaveURL(/p=QsKh&p=\?Qd/)
  })

  test('the picker supports keyboard selection and closes with Escape', async ({ page }) => {
    await page.goto('/holdem?p=??&p=QsQd')
    await page.getByRole('button', { name: /^Hero card 1:/ }).click()
    const picker = page.getByRole('dialog', { name: /Pick a card/ })
    await page.keyboard.type('ah')
    await expect(page.getByRole('button', { name: /^Hero card 1: Ace of hearts/ })).toBeVisible()
    // Picker advanced to the second slot.
    await page.keyboard.type('kh')
    await expect(page.getByRole('button', { name: /^Hero card 2: King of hearts/ })).toBeVisible()
    await expect(picker).toBeHidden()
    await waitDone(page)
    await expect(summaryValue(page, 'Hero')).toHaveText('46.21%')
  })

  test('Monte Carlo shows an interval and stops at the target', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=??&p=??&p=??')
    await expect(methodBadge(page)).toHaveText('Monte Carlo')
    await waitDone(page)
    await expect(page.locator('.method-detail').first()).toHaveText(/±0\.\d+% at 95%/)
    const value = Number((await summaryValue(page, 'Hero').textContent())!.replace('%', ''))
    // AKs against three random hands: 41.43% (seeded 20M-trial reference in preflopRanking.ts).
    expect(Math.abs(value - 41.43)).toBeLessThan(0.3)
    await expect(page.locator('.equity-bar-ci').first()).toBeVisible()
  })

  test('switching games keeps clean routes and history', async ({ page }) => {
    await page.goto('/holdem')
    await waitDone(page)
    await page.getByRole('link', { name: 'PLO4' }).click()
    await expect(page).toHaveURL(/\/plo\?/)
    await waitDone(page)
    await expect(summaryValue(page, 'Hero')).toHaveText('61.48%')
    await expect(page.getByRole('button', { name: 'Range' })).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(/\/holdem/)
    await waitDone(page)
    await expect(summaryValue(page, 'Hero')).toHaveText('41.90%')
  })

  test('short deck rule sets change the result', async ({ page }) => {
    await page.goto('/short-deck?p=AsAh&p=KsKh')
    await waitDone(page)
    await expect(summaryValue(page, 'Hero')).toHaveText('74.96%')
    await page.getByRole('button', { name: 'Classic' }).click()
    await waitDone(page)
    await expect(summaryValue(page, 'Hero')).toHaveText('75.02%')
    await expect(page).toHaveURL(/rules=classic/)
  })

  test('painting the range grid rewrites the range', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=r:AA')
    await waitDone(page)
    const kk = page.locator('.range-cell', { hasText: /^KK$/ })
    const qq = page.locator('.range-cell', { hasText: /^QQ$/ })
    const a = await kk.boundingBox()
    const b = await qq.boundingBox()
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2)
    await page.mouse.down()
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(page.locator('#range-1')).toHaveValue('QQ+')
    await page.getByRole('button', { name: '50%' }).click()
    await page.locator('.range-cell', { hasText: /^AKs$/ }).click()
    await expect(page.locator('#range-1')).toHaveValue('QQ+, AKs:50%')
    await expect(page.locator('.range-meta')).toContainText('20 combos')
    // Undo reverts the last paint.
    await page.locator('body').click({ position: { x: 5, y: 300 } })
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.locator('#range-1')).toHaveValue('QQ+')
  })

  test('percent slider and presets build ranges', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=r:AA')
    await page.getByRole('button', { name: 'Top 5%' }).click()
    await expect(page.locator('#range-1')).toHaveValue('5%')
    await expect(page.locator('.range-meta')).toContainText(/6[0-9] combos/)
    await page.getByRole('slider', { name: 'Range ends at percent' }).fill('30')
    await expect(page.locator('#range-1')).toHaveValue('30%')
  })

  test('next card heatmap covers every turn card and deals on click', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=QsQd&b=Jh7h2c')
    await waitDone(page)
    const cells = page.locator('.nextcard-cell:not(.is-used)')
    await expect(cells).toHaveCount(45)
    await expect(page.locator('.nextcard-stats')).toContainText('improve', { timeout: 30_000 })
    await expect(cells.filter({ hasText: /^\d+$/ })).toHaveCount(45, { timeout: 30_000 })
    await page.getByRole('gridcell', { name: /^Ten of hearts: 100.0% equity/ }).click()
    await expect(page).toHaveURL(/b=Jh7h2cTh/)
    await waitDone(page)
    await expect(page.getByRole('heading', { name: 'Every river card' })).toBeVisible()
  })

  test('pot odds gives a verdict', async ({ page }) => {
    await page.goto('/holdem?p=AsAh&p=KsKh')
    await waitDone(page)
    await expect(page.locator('.potodds-verdict')).toHaveText('Profitable call')
    await page.getByLabel('To call').fill('1000')
    await expect(page.locator('.potodds-verdict')).toHaveText('Losing call')
  })

  test('explains invalid spots without breaking', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=r:AA')
    await page.locator('#range-1').fill('zzz')
    await expect(page.locator('.player-problem')).toHaveText('Range has no valid hands')
    await expect(page.locator('.method-badge')).toHaveText('Waiting for a complete spot')
    await page.locator('#range-1').fill('KK')
    await waitDone(page)
    await expect(heroEquity(page)).toBeVisible()
  })

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/holdem?p=AhKh&p=QsQd&b=Jh7h2c')
    await waitDone(page)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})

test.describe('site', () => {
  test('route pages carry their own SEO metadata', async ({ page }) => {
    await page.goto('/plo')
    await expect(page).toHaveTitle(/PLO/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://hookah-pookah.pages.dev/plo')
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og\.png$/)
  })

  test('clean routes answer directly without redirects', async ({ request }) => {
    for (const path of ['/holdem', '/short-deck', '/plo', '/plo5']) {
      const res = await request.get(`${path}?p=AhKh`, { maxRedirects: 0 })
      expect(res.status(), path).toBe(200)
      expect(await res.text()).toContain(`<link rel="canonical" href="https://hookah-pookah.pages.dev${path}"`)
    }
  })

  test('robots, sitemap and security headers are served', async ({ request }) => {
    const robots = await request.get('/robots.txt')
    expect(await robots.text()).toContain('Sitemap: https://hookah-pookah.pages.dev/sitemap.xml')
    const sitemap = await request.get('/sitemap.xml')
    expect(await sitemap.text()).toContain('<loc>https://hookah-pookah.pages.dev/short-deck</loc>')
    const home = await request.get('/holdem')
    expect(home.headers()['content-security-policy']).toContain("worker-src 'self'")
    expect(home.headers()['x-content-type-options']).toBe('nosniff')
  })

  test('no console errors or CSP violations during a full session', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/holdem?p=AhKh&p=??&p=??&b=Jh7h2c')
    await waitDone(page)
    await expect(page.locator('.nextcard-cell').filter({ hasText: /^\d+$/ }).first()).toBeVisible({ timeout: 30_000 })
    expect(errors).toEqual([])
  })
})
