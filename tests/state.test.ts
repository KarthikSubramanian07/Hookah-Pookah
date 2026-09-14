import { describe, expect, it } from 'vitest'
import { CardParseError, findDuplicate, formatCard, formatCards, isValidCard, parseCard, parseCards } from '../src/engine/cards.ts'
import { Rng } from '../src/engine/rng.ts'
import { cardInDeck, deckFor, isVariantId } from '../src/engine/variants.ts'
import { parseQuickSpot } from '../src/state/quickSpot.ts'
import { compileSpot, defaultSpot, describeCards, emptyPlayer, reserveIds, usedCards } from '../src/state/spot.ts'
import { spotFromUrl, spotToUrl, variantFromPath } from '../src/state/url.ts'

describe('cards', () => {
  it('parses and formats', () => {
    expect(formatCard(parseCard('Ah'))).toBe('Ah')
    expect(formatCard(parseCard('td'))).toBe('Td')
    expect(formatCard(parseCard('10s'))).toBe('Ts')
    expect(formatCards(parseCards('ah kd, 10c;2s'))).toBe('AhKdTc2s')
    expect(parseCard('2c')).toBe(0)
    expect(parseCard('As')).toBe(51)
  })
  it('rejects bad input', () => {
    expect(() => parseCard('1h')).toThrow(CardParseError)
    expect(() => parseCard('Ahh')).toThrow(CardParseError)
    expect(() => parseCards('AhK')).toThrow(/Invalid card near/)
    expect(isValidCard(52)).toBe(false)
    expect(isValidCard(3.5)).toBe(false)
  })
  it('finds duplicates', () => {
    expect(findDuplicate(parseCards('AhKdAh'))).toBe(parseCard('Ah'))
    expect(findDuplicate(parseCards('AhKd'))).toBeUndefined()
  })
  it('knows deck membership per variant', () => {
    expect(deckFor('holdem')).toHaveLength(52)
    expect(deckFor('shortdeck')).toHaveLength(36)
    expect(cardInDeck('shortdeck', parseCard('5h'))).toBe(false)
    expect(cardInDeck('shortdeck', parseCard('6h'))).toBe(true)
    expect(isVariantId('omaha5')).toBe(true)
    expect(isVariantId('stud')).toBe(false)
  })
})

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32())
    expect(new Rng(1).nextU32()).not.toBe(new Rng(2).nextU32())
  })
  it('draws uniform integers (chi-square)', () => {
    const rng = new Rng(2026)
    for (const n of [2, 7, 45, 52]) {
      const counts = new Array(n).fill(0)
      const draws = n * 4000
      for (let i = 0; i < draws; i++) {
        const x = rng.nextInt(n)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(n)
        counts[x]++
      }
      const expected = draws / n
      const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0)
      // Mean n-1, sd sqrt(2(n-1)); 6 sd is a generous, flake-free bound.
      expect(chi).toBeLessThan(n - 1 + 6 * Math.sqrt(2 * (n - 1)))
    }
    expect(rng.nextInt(1)).toBe(0)
    const f = rng.nextFloat()
    expect(f >= 0 && f < 1).toBe(true)
  })
})

describe('spot model', () => {
  it('compiles the default spot for every variant', () => {
    for (const v of ['holdem', 'shortdeck', 'omaha4', 'omaha5'] as const) {
      const compiled = compileSpot(defaultSpot(v))
      expect(compiled.problems).toEqual([])
      expect(compiled.request?.variant).toBe(v)
    }
  })
  it('reports empty ranges, range issues and board gaps', () => {
    const spot = defaultSpot('holdem')
    spot.players[1].range = ''
    expect(compileSpot(spot).problems[0].message).toBe('Range is empty')
    spot.players[1].range = 'QQ+, bogus'
    const c = compileSpot(spot)
    expect(c.rangeIssues.get(1)?.[0].token).toBe('bogus')
    expect(c.rangeSizes.get(1)).toBe(18)
    spot.players[1].range = 'bogus'
    expect(compileSpot(spot).problems[0].message).toBe('Range has no valid hands')
    spot.players[1].range = 'QQ'
    spot.board = [parseCard('2c'), null, parseCard('3c'), null, null]
    expect(compileSpot(spot).problems[0].where).toBe('board')
  })
  it('lists used cards with owners', () => {
    const spot = defaultSpot('holdem')
    spot.board[0] = parseCard('2c')
    spot.dead = [parseCard('3c')]
    const used = usedCards(spot)
    expect(used.get(parseCard('Ah'))).toBe('P1')
    expect(used.get(parseCard('2c'))).toBe('Board')
    expect(used.get(parseCard('3c'))).toBe('Dead')
    expect(describeCards([parseCard('Ah'), null])).toBe('Ah?')
  })
  it('reserves ids so restored players never collide', () => {
    reserveIds([10_000])
    expect(emptyPlayer('holdem').id).toBeGreaterThan(10_000)
  })
})

describe('share URLs', () => {
  it('round trips a rich spot', () => {
    const spot = defaultSpot('holdem')
    spot.players[0].cards = [parseCard('Ah'), null]
    spot.players[1].range = 'QQ+, AKs:0.5, [25]T9s[/25], 15%'
    spot.players.push({ id: 99, mode: 'cards', cards: [null, null], range: '' })
    spot.board = [...parseCards('Ks7h2d'), null, null]
    spot.dead = parseCards('2c')
    spot.ranking = 'vs1'
    const url = spotToUrl(spot)
    expect(url).toBe('/holdem?p=Ah?&p=r:QQ%2B,AKs:0.5,[25]T9s[/25],15%25&p=??&b=Ks7h2d&d=2c&rank=vs1')
    const q = url.indexOf('?')
    const back = spotFromUrl(url.slice(0, q), url.slice(q))
    const norm = (r: string) => r.replace(/\s+/g, '')
    expect(back.players.map((p) => ({ mode: p.mode, cards: p.cards, range: norm(p.range) }))).toEqual(
      spot.players.map((p) => ({ mode: p.mode, cards: p.cards, range: norm(p.range) })),
    )
    expect(back.board).toEqual(spot.board)
    expect(back.dead).toEqual(spot.dead)
    expect(back.ranking).toBe('vs1')
  })
  it('maps clean paths to variants', () => {
    expect(variantFromPath('/short-deck/')).toBe('shortdeck')
    expect(variantFromPath('/PLO')).toBe('omaha4')
    expect(variantFromPath('/plo5')).toBe('omaha5')
    expect(variantFromPath('/')).toBeUndefined()
    const sd = defaultSpot('shortdeck')
    sd.shortDeckRules = 'classic'
    expect(spotToUrl(sd)).toContain('rules=classic')
    expect(spotFromUrl('/short-deck', '?p=AsKs&rules=classic').shortDeckRules).toBe('classic')
  })
  it('falls back gracefully on malformed or hostile input', () => {
    expect(spotFromUrl('/nowhere', '').variant).toBe('holdem')
    const s = spotFromUrl('/short-deck', '?p=AhAh&p=5c5d&p=zz&b=AhKsQsJsTs9s&d=%E0%A4%A&p=r:AA')
    expect(s.players[0].cards).toEqual([parseCard('Ah'), null])
    expect(s.players[1].cards).toEqual([null, null])
    expect(s.players[2].cards).toEqual([null, null])
    expect(s.board.filter((c) => c !== null)).toHaveLength(5)
    expect(s.players[3].mode).toBe('range')
    // Literal plus signs in hand-edited URLs stay plus signs.
    expect(spotFromUrl('/holdem', '?p=r:QQ+').players[0].range).toBe('QQ+')
    // Ranges are ignored for Omaha.
    expect(spotFromUrl('/plo', '?p=r:AA&p=10hJhQhKh').players[1].cards[0]).toBe(parseCard('Th'))
  })
})

describe('quick spot', () => {
  const base = defaultSpot('holdem')
  it('parses players, ranges, board and dead cards', () => {
    const { spot, error } = parseQuickSpot('AhKh vs QQ+, AKs vs random on Ks7h2d dead 2c', base)
    expect(error).toBeUndefined()
    expect(spot!.players).toHaveLength(3)
    expect(spot!.players[0].cards).toEqual(parseCards('AhKh'))
    expect(spot!.players[1]).toMatchObject({ mode: 'range', range: 'QQ+, AKs' })
    expect(spot!.players[2].cards).toEqual([null, null])
    expect(spot!.board.slice(0, 3)).toEqual(parseCards('Ks7h2d'))
    expect(spot!.dead).toEqual(parseCards('2c'))
  })
  it('supports partial hands and pipe boards', () => {
    const { spot } = parseQuickSpot('Ah v 22+ | Kd7h', base)
    expect(spot!.players[0].cards).toEqual([parseCard('Ah'), null])
    expect(spot!.board.slice(0, 2)).toEqual(parseCards('Kd7h'))
  })
  it('explains problems', () => {
    expect(parseQuickSpot('', base).error).toMatch(/Type a spot/)
    expect(parseQuickSpot('AhKh vs AhQd', base).error).toMatch(/Ah appears twice/)
    expect(parseQuickSpot('AhKh on Zz', base).error).toMatch(/board/)
    expect(parseQuickSpot('AhKh dead Q', base).error).toMatch(/dead/)
    expect(parseQuickSpot('AhKh vs nonsense', base).error).toMatch(/could not read/)
    expect(parseQuickSpot('AhKh on 2c3c4c5c6c7c', base).error).toMatch(/five cards/)
    expect(parseQuickSpot(Array(11).fill('random').join(' vs '), base).error).toMatch(/at most 10/)
    expect(parseQuickSpot('5h5d vs AA', defaultSpot('shortdeck')).error).toMatch(/not in the Short Deck deck/)
    expect(parseQuickSpot('AsAhKsKh vs QQ+', defaultSpot('omaha4')).error).toMatch(/ranges are Hold'em/)
  })
})
