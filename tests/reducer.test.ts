import { describe, expect, it } from 'vitest'
import { parseCard, parseCards } from '../src/engine/cards.ts'
import { defaultSpot } from '../src/state/spot.ts'
import { PAGES, renderPage, renderSitemap } from '../scripts/postbuild.ts'
import { type SpotState, applyAction, spotReducer } from '../src/ui/useSpot.ts'

const initial = (): SpotState => ({ spot: defaultSpot('holdem'), past: [], future: [], byVariant: {}, lastAt: 0 })

describe('spot reducer', () => {
  it('moves a card from its previous owner instead of duplicating it', () => {
    const spot = defaultSpot('holdem')
    const next = applyAction(spot, { type: 'card', ref: { kind: 'board', slot: 0 }, card: parseCard('Ah') })
    expect(next.board[0]).toBe(parseCard('Ah'))
    expect(next.players[0].cards).toEqual([null, parseCard('Kh')])
  })

  it('manages dead cards as a compact list', () => {
    let spot = defaultSpot('holdem')
    spot = applyAction(spot, { type: 'card', ref: { kind: 'dead', slot: 0 }, card: parseCard('2c') })
    spot = applyAction(spot, { type: 'card', ref: { kind: 'dead', slot: 5 }, card: parseCard('3c') })
    expect(spot.dead).toEqual(parseCards('2c3c'))
    spot = applyAction(spot, { type: 'card', ref: { kind: 'dead', slot: 0 }, card: parseCard('4c') })
    expect(spot.dead).toEqual(parseCards('4c3c'))
    spot = applyAction(spot, { type: 'card', ref: { kind: 'dead', slot: 0 }, card: null })
    expect(spot.dead).toEqual(parseCards('3c'))
    expect(applyAction(spot, { type: 'clearDead' }).dead).toEqual([])
  })

  it('adds, removes, reorders and clears players within limits', () => {
    let spot = defaultSpot('holdem')
    spot = applyAction(spot, { type: 'addPlayer', mode: 'range', range: '22+' })
    expect(spot.players[2]).toMatchObject({ mode: 'range', range: '22+' })
    spot = applyAction(spot, { type: 'movePlayer', player: 2, delta: -1 })
    expect(spot.players[1].range).toBe('22+')
    expect(applyAction(spot, { type: 'movePlayer', player: 0, delta: -1 })).toBe(spot)
    spot = applyAction(spot, { type: 'removePlayer', player: 1 })
    expect(spot.players).toHaveLength(2)
    spot = applyAction(spot, { type: 'clearPlayer', player: 0 })
    expect(spot.players[0].cards).toEqual([null, null])
    let full = defaultSpot('omaha5')
    for (let i = 0; i < 12; i++) full = applyAction(full, { type: 'addPlayer' })
    expect(full.players).toHaveLength(9)
    const one = { ...defaultSpot('holdem'), players: [defaultSpot('holdem').players[0]] }
    expect(applyAction(one, { type: 'removePlayer', player: 0 })).toBe(one)
  })

  it('refuses ranges for Omaha and switches modes elsewhere', () => {
    const plo = defaultSpot('omaha4')
    expect(applyAction(plo, { type: 'mode', player: 0, mode: 'range' })).toBe(plo)
    const he = applyAction(defaultSpot('holdem'), { type: 'mode', player: 0, mode: 'range' })
    expect(he.players[0].mode).toBe('range')
    expect(applyAction(he, { type: 'range', player: 0, text: 'AA' }).players[0].range).toBe('AA')
  })

  it('deals random boards up to a street without touching used cards', () => {
    const spot = defaultSpot('holdem')
    let seed = 0.1
    const random = () => (seed = (seed * 9301 + 0.49297) % 1)
    const flop = applyAction(spot, { type: 'dealBoard', upTo: 3, random })
    const dealt = flop.board.filter((c) => c !== null)
    expect(dealt).toHaveLength(3)
    expect(dealt.some((c) => parseCards('AhKh').includes(c!))).toBe(false)
    const river = applyAction(flop, { type: 'dealBoard', upTo: 5, random })
    expect(river.board.slice(0, 3)).toEqual(flop.board.slice(0, 3))
    expect(new Set(river.board).size).toBe(5)
    expect(applyAction(river, { type: 'clearBoard' }).board).toEqual([null, null, null, null, null])
  })

  it('sets rules, ranking and resets everything', () => {
    let spot = defaultSpot('shortdeck')
    spot = applyAction(spot, { type: 'rules', rules: 'classic' })
    spot = applyAction(spot, { type: 'ranking', ranking: 'vs1' })
    expect(spot).toMatchObject({ shortDeckRules: 'classic', ranking: 'vs1' })
    const cleared = applyAction(spot, { type: 'clearAll' })
    expect(cleared.players.every((p) => p.cards.every((c) => c === null) && p.range === '')).toBe(true)
    expect(applyAction(spot, { type: 'replace', spot: cleared })).toBe(cleared)
  })

  it('tracks undo and redo, merging bursts of range typing', () => {
    let s = initial()
    s = spotReducer(s, { type: 'range', player: 1, text: 'Q', typing: true })
    s = spotReducer(s, { type: 'range', player: 1, text: 'QQ', typing: true })
    s = spotReducer(s, { type: 'range', player: 1, text: 'QQ+', typing: true })
    expect(s.past).toHaveLength(1)
    // Grid edits never merge, even in quick succession.
    const grid = spotReducer(spotReducer(s, { type: 'range', player: 1, text: 'QQ+, AKs' }), { type: 'range', player: 1, text: 'QQ+, AKs, AQs' })
    expect(grid.past).toHaveLength(3)
    s = spotReducer(s, { type: 'clearBoard' }) // no-op: board already empty
    expect(s.past).toHaveLength(1)
    s = spotReducer(s, { type: 'card', ref: { kind: 'board', slot: 0 }, card: parseCard('2c') })
    expect(s.past).toHaveLength(2)
    s = spotReducer(s, { type: 'undo' })
    expect(s.spot.board[0]).toBeNull()
    s = spotReducer(s, { type: 'undo' })
    expect(s.spot.players[1].range).toBe('')
    expect(spotReducer(s, { type: 'undo' })).toBe(s)
    s = spotReducer(s, { type: 'redo' })
    s = spotReducer(s, { type: 'redo' })
    expect(s.spot.board[0]).toBe(parseCard('2c'))
    expect(spotReducer(s, { type: 'redo' })).toBe(s)
  })

  it('remembers each variant when switching games', () => {
    let s = initial()
    s = spotReducer(s, { type: 'card', ref: { kind: 'board', slot: 0 }, card: parseCard('9d') })
    s = spotReducer(s, { type: 'variant', variant: 'omaha4' })
    expect(s.spot.variant).toBe('omaha4')
    expect(s.past).toEqual([])
    s = spotReducer(s, { type: 'variant', variant: 'holdem' })
    expect(s.spot.board[0]).toBe(parseCard('9d'))
    expect(spotReducer(s, { type: 'variant', variant: 'holdem' })).toBe(s)
  })
})

describe('post-build SEO pages', () => {
  const template = `<title>x</title><meta name="description" content="d" /><link rel="canonical" href="c" /><meta property="og:url" content="u" /><meta property="og:title" content="t" /><meta property="og:description" content="d" /><meta name="twitter:title" content="t" /><meta name="twitter:description" content="d" />`
  it('rewrites title, description, canonical and social tags per route', () => {
    for (const page of PAGES) {
      const html = renderPage(template, page)
      expect(html).toContain(`<link rel="canonical" href="https://hookah-pookah.pages.dev${page.path}" />`)
      expect(html).toContain(`<meta property="og:url" content="https://hookah-pookah.pages.dev${page.path}" />`)
      expect(html).not.toContain('<title>x</title>')
      expect(html).not.toContain('content="d"')
    }
    expect(renderPage(template, PAGES[1])).toContain("Short Deck (6+) Hold'em")
  })
  it('lists every route in the sitemap', () => {
    const xml = renderSitemap('2026-09-14')
    for (const page of PAGES) expect(xml).toContain(`<loc>https://hookah-pookah.pages.dev${page.path}</loc>`)
    expect(xml).toContain('<lastmod>2026-09-14</lastmod>')
  })
})
