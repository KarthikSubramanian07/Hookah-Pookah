/**
 * Renders public/og.png (1200x630 social card) and PNG app icons with headless Chromium.
 * The equities on the card are computed by the engine at generation time, so they are real.
 * Usage: node scripts/gen-og.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { parseCards } from '../src/engine/cards.ts'
import { calculateEquity } from '../src/engine/equity.ts'
import { comboFromKey, parseRange } from '../src/engine/ranges.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const font = (pkg: string, file: string) => readFileSync(`${root}node_modules/@fontsource-variable/${pkg}/files/${file}`).toString('base64')

const range = [...parseRange('QQ+, AKs, AKo').combos].map(([k, w]) => ({ cards: comboFromKey(k), weight: w }))
const result = calculateEquity({ variant: 'holdem', players: [{ cards: parseCards('AhKh') }, { range }], board: parseCards('Qh7h2c') })
const hero = (result.players[0].equity * 100).toFixed(2)
const villain = (result.players[1].equity * 100).toFixed(2)

const card = (rank: string, suit: string, color: string) =>
  `<div class="card" style="color:${color}"><span class="r">${rank}</span><span class="s">${suit}</span></div>`

const html = `<!doctype html><html><head><style>
@font-face { font-family: Fraunces; src: url(data:font/woff2;base64,${font('fraunces', 'fraunces-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font('inter-tight', 'inter-tight-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: Mono; src: url(data:font/woff2;base64,${font('jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0 }
body { width: 1200px; height: 630px; overflow: hidden; background: oklch(0.155 0.012 252); color: oklch(0.955 0.006 252); font-family: Inter; }
.smoke { position: absolute; inset: 0; background:
  radial-gradient(520px 360px at 8% 0%, oklch(0.742 0.14 247.4 / 0.18), transparent 70%),
  radial-gradient(520px 420px at 100% 100%, oklch(0.76 0.155 52 / 0.14), transparent 70%); }
.wrap { position: relative; display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; height: 100%; padding: 64px 72px; }
.brand { display: flex; align-items: center; gap: 14px; font-family: Fraunces; font-size: 34px; font-weight: 620; }
h1 { margin-top: 64px; font-family: Fraunces; font-size: 76px; line-height: 0.98; font-weight: 560; letter-spacing: -0.03em; }
p { margin-top: 26px; color: oklch(0.8 0.015 252); font-size: 27px; line-height: 1.35; }
.panel { align-self: center; padding: 34px; border: 1px solid oklch(0.33 0.018 252); border-radius: 26px; background: oklch(0.195 0.014 252 / 0.9); }
.cards { display: flex; gap: 10px; margin-bottom: 26px; }
.card { display: flex; flex-direction: column; justify-content: space-between; width: 70px; height: 96px; padding: 8px 9px; border-radius: 11px; background: oklch(0.975 0.004 252); box-shadow: inset 0 0 0 1px oklch(0.86 0.01 252); }
.r { font-size: 30px; font-weight: 750; letter-spacing: -0.04em; } .s { align-self: flex-end; font-size: 34px; line-height: 0.9 }
.gap { width: 18px }
.badge { display: inline-flex; gap: 8px; align-items: center; padding: 5px 14px; border-radius: 99px; background: oklch(0.79 0.15 158 / 0.16); color: oklch(0.79 0.15 158); font-weight: 700; font-size: 20px; }
.row { display: grid; grid-template-columns: 110px 1fr 150px; align-items: center; gap: 18px; margin-top: 24px; font-size: 22px; font-weight: 600; }
.track { height: 16px; border-radius: 99px; background: oklch(0.235 0.016 252); overflow: hidden }
.fill { height: 100% } .val { text-align: right; font-family: Mono; font-size: 34px; font-weight: 650; letter-spacing: -0.03em }
</style></head><body><div class="smoke"></div><div class="wrap">
<div>
  <div class="brand"><svg viewBox="0 0 32 32" width="44" height="44"><path d="M16 3c3 3 3 6 0 9s-3 6 0 9" fill="none" stroke="oklch(0.742 0.14 247.4)" stroke-width="2" stroke-linecap="round"/><rect x="7" y="20" width="18" height="9" rx="4.5" fill="oklch(0.76 0.155 52)"/><circle cx="16" cy="24.5" r="2" fill="oklch(0.155 0.012 252)"/></svg>Hookah Pookah</div>
  <h1>What are the chances?</h1>
  <p>Exact poker equity for Hold'em, Short Deck and PLO. Honest error bars when exact is too big.</p>
</div>
<div class="panel">
  <div class="cards">${card('A', '♥', 'oklch(0.56 0.2 25)')}${card('K', '♥', 'oklch(0.56 0.2 25)')}<div class="gap"></div>${card('Q', '♥', 'oklch(0.56 0.2 25)')}${card('7', '♥', 'oklch(0.56 0.2 25)')}${card('2', '♣', 'oklch(0.53 0.13 150)')}</div>
  <span class="badge">● Exact</span>
  <div class="row"><span style="color:oklch(0.76 0.155 52)">AhKh</span><div class="track"><div class="fill" style="width:${hero}%;background:oklch(0.76 0.155 52)"></div></div><span class="val">${hero}%</span></div>
  <div class="row"><span style="color:oklch(0.76 0.12 238)">QQ+, AK</span><div class="track"><div class="fill" style="width:${villain}%;background:oklch(0.76 0.12 238)"></div></div><span class="val">${villain}%</span></div>
</div>
</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: `${root}public/og.png` })

const icon = readFileSync(`${root}public/favicon.svg`, 'utf8')
for (const [size, name] of [
  [180, 'apple-touch-icon.png'],
  [512, 'icon-512.png'],
] as const) {
  const p = await browser.newPage({ viewport: { width: size, height: size } })
  await p.setContent(`<html><body style="margin:0;background:#11151c">${icon.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await p.screenshot({ path: `${root}public/${name}` })
}
await browser.close()
console.log(`og.png rendered with AhKh ${hero}% vs QQ+,AK ${villain}%`)
