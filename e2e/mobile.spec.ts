import { expect, test } from '@playwright/test'

test('mobile layout fits the viewport and the picker becomes a bottom sheet', async ({ page }) => {
  await page.goto('/holdem?p=AhKh&p=QsQd&b=Jh7h2c')
  await expect(page.locator('.answer')).toHaveAttribute('data-state', 'done', { timeout: 45_000 })
  // The docked answer is on screen while the full panel is below the fold.
  await expect(page.locator('.answer-dock')).toHaveAttribute('data-hidden', 'false')
  await expect(page.locator('.answer-dock-value')).toHaveText(/%$/)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  await page.getByRole('button', { name: /^Turn: empty/ }).click()
  const picker = page.getByRole('dialog', { name: /Pick a card/ })
  await expect(picker).toBeVisible()
  const box = await picker.boundingBox()
  const viewport = page.viewportSize()!
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(viewport.height - 2)
  await picker.getByRole('gridcell', { name: /^Two of spades$/ }).tap()
  await expect(page).toHaveURL(/b=Jh7h2c2s/)
})
