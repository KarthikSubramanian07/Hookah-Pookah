import { describe, expect, it } from 'vitest'
import { parseCards } from '../src/engine/cards.ts'
import {
  CATEGORY_NAMES,
  HandCategory,
  RULES_SHORT_CLASSIC,
  RULES_SHORT_TRITON,
  RULES_STANDARD,
  type Rules,
  categoryOf,
  describeValue,
  evaluate,
  evaluateOmaha,
  rulesFor,
} from '../src/engine/evaluator.ts'
import { Rng } from '../src/engine/rng.ts'
import {
  REF_SHORT_CLASSIC,
  REF_SHORT_TRITON,
  REF_STANDARD,
  type RefRules,
  refCompare,
  refEvalBest,
  refEvalOmaha,
} from './reference.ts'

/** Exhaustively evaluates every k-card hand from the deck and tallies categories and distinct values. */
function exhaustive(rules: Rules, lowRank: number, k: number) {
  const deck: number[] = []
  for (let c = lowRank * 4; c < 52; c++) deck.push(c)
  const N = deck.length
  const counts = new Array(9).fill(0)
  const distinct = new Set<number>()
  const idx = Array.from({ length: k }, (_, i) => i)
  const m = [0, 0, 0, 0]
  for (;;) {
    m[0] = m[1] = m[2] = m[3] = 0
    for (let i = 0; i < k; i++) {
      const c = deck[idx[i]]
      m[c & 3] |= 1 << (c >> 2)
    }
    const v = rules.evalMasks(m[0], m[1], m[2], m[3], k)
    counts[categoryOf(v)]++
    distinct.add(v)
    let i = k - 1
    while (i >= 0 && idx[i] === N - k + i) i--
    if (i < 0) break
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
  return { counts, distinct: distinct.size }
}

// Order: high card, pair, two pair, trips, straight, flush, full house, quads, straight flush.
describe('exhaustive category counts', () => {
  it('matches the 2,598,960 five-card hands and 7462 classes', () => {
    const r = exhaustive(RULES_STANDARD, 0, 5)
    expect(r.counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40])
    expect(r.distinct).toBe(7462)
  })

  it('matches the 376,992 short deck five-card hands and 1404 classes', () => {
    const r = exhaustive(RULES_SHORT_TRITON, 4, 5)
    expect(r.counts).toEqual([122400, 193536, 36288, 16128, 6120, 480, 1728, 288, 24])
    expect(r.distinct).toBe(1404)
  })

  it('matches short deck seven-card counts under Triton rules (762 classes)', () => {
    const r = exhaustive(RULES_SHORT_TRITON, 4, 7)
    expect(r.counts).toEqual([233100, 2316600, 3157056, 637560, 1139580, 175560, 633024, 44640, 10560])
    expect(r.distinct).toBe(762)
  })

  it('matches short deck seven-card counts under classic rules (752 classes)', () => {
    const r = exhaustive(RULES_SHORT_CLASSIC, 4, 7)
    expect(r.counts).toEqual([233100, 2316600, 3157056, 607200, 1169940, 175560, 633024, 44640, 10560])
    expect(r.distinct).toBe(752)
  })
})

function randomHand(rng: Rng, lowRank: number, k: number): number[] {
  const deck: number[] = []
  for (let c = lowRank * 4; c < 52; c++) deck.push(c)
  for (let i = 0; i < k; i++) {
    const j = i + rng.nextInt(deck.length - i)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.slice(0, k)
}

describe('agreement with the naive reference evaluator', () => {
  const cases: [string, Rules, RefRules, number][] = [
    ['standard', RULES_STANDARD, REF_STANDARD, 0],
    ['short deck triton', RULES_SHORT_TRITON, REF_SHORT_TRITON, 4],
    ['short deck classic', RULES_SHORT_CLASSIC, REF_SHORT_CLASSIC, 4],
  ]
  for (const [name, rules, ref, low] of cases) {
    for (const k of [5, 6, 7]) {
      it(`${name}: ${k}-card hands order identically`, () => {
        const rng = new Rng(1000 + k + low)
        for (let t = 0; t < 4000; t++) {
          const a = randomHand(rng, low, k)
          const b = randomHand(rng, low, k)
          const mine = Math.sign(evaluate(a, rules) - evaluate(b, rules))
          const theirs = Math.sign(refCompare(refEvalBest(a, ref), refEvalBest(b, ref), ref))
          if (mine !== theirs) throw new Error(`Order mismatch for ${a} vs ${b}`)
          expect(categoryOf(evaluate(a, rules))).toBe(refEvalBest(a, ref).category)
        }
      })
    }
  }

  for (const holeCount of [4, 5]) {
    it(`Omaha with ${holeCount} hole cards uses exactly two plus three`, () => {
      const rng = new Rng(77 + holeCount)
      for (let t = 0; t < 1500; t++) {
        const cards = randomHand(rng, 0, holeCount * 2 + 5)
        const h1 = cards.slice(0, holeCount)
        const h2 = cards.slice(holeCount, holeCount * 2)
        const board = cards.slice(holeCount * 2)
        const mine = Math.sign(evaluateOmaha(h1, board) - evaluateOmaha(h2, board))
        const theirs = Math.sign(refCompare(refEvalOmaha(h1, board, REF_STANDARD), refEvalOmaha(h2, board, REF_STANDARD), REF_STANDARD))
        expect(mine).toBe(theirs)
      }
    })
  }
})

describe('rule specific hands', () => {
  const v = (text: string, rules: Rules = RULES_STANDARD) => evaluate(parseCards(text), rules)

  it('treats the wheel as the lowest straight', () => {
    expect(v('Ah2c3d4s5h')).toBeLessThan(v('2c3d4s5h6h'))
    expect(categoryOf(v('Ah2c3d4s5h'))).toBe(HandCategory.Straight)
    expect(categoryOf(v('AhKcQdJsTh'))).toBe(HandCategory.Straight)
  })

  it('does not wrap straights around the ace', () => {
    expect(categoryOf(v('QhKcAd2s3h'))).toBe(HandCategory.HighCard)
  })

  it('uses A-6-7-8-9 as the short deck wheel', () => {
    expect(categoryOf(v('Ah6c7d8s9h', RULES_SHORT_TRITON))).toBe(HandCategory.Straight)
    expect(v('Ah6c7d8s9h', RULES_SHORT_TRITON)).toBeLessThan(v('6c7d8s9hTh', RULES_SHORT_TRITON))
  })

  it('ranks flush over full house in short deck only', () => {
    const flush = 'AhJh9h7h6h'
    const boat = 'KsKdKh6c6d'
    expect(v(flush)).toBeLessThan(v(boat))
    expect(v(flush, RULES_SHORT_TRITON)).toBeGreaterThan(v(boat, RULES_SHORT_TRITON))
    expect(v(flush, RULES_SHORT_CLASSIC)).toBeGreaterThan(v(boat, RULES_SHORT_CLASSIC))
  })

  it('ranks trips over a straight under Triton rules and below it under classic rules', () => {
    const trips = 'TsTdTh7c6d'
    const straight = '6c7d8s9hTh'
    expect(v(trips, RULES_SHORT_TRITON)).toBeGreaterThan(v(straight, RULES_SHORT_TRITON))
    expect(v(trips, RULES_SHORT_CLASSIC)).toBeLessThan(v(straight, RULES_SHORT_CLASSIC))
  })

  it('prefers trips over a coexisting straight in seven Triton cards', () => {
    const value = v('7s7d7h8c9dTsJh', RULES_SHORT_TRITON)
    expect(categoryOf(value)).toBe(HandCategory.Trips)
    expect(categoryOf(v('7s7d7h8c9dTsJh', RULES_SHORT_CLASSIC))).toBe(HandCategory.Straight)
  })

  it('plays the board when kickers do not matter', () => {
    expect(v('2c3dAhAsKdKcQh')).toBe(v('4c5dAhAsKdKcQh'))
  })

  it('picks the best full house from two sets of trips', () => {
    expect(describeValue(v('7s7d7hKcKdKs2h'))).toBe('Full House, Kings full of Sevens')
  })

  it('selects rules per variant', () => {
    expect(rulesFor('holdem')).toBe(RULES_STANDARD)
    expect(rulesFor('omaha4')).toBe(RULES_STANDARD)
    expect(rulesFor('shortdeck')).toBe(RULES_SHORT_TRITON)
    expect(rulesFor('shortdeck', 'classic')).toBe(RULES_SHORT_CLASSIC)
    expect(RULES_SHORT_TRITON.ranking.indexOf(HandCategory.Trips)).toBeGreaterThan(RULES_SHORT_TRITON.ranking.indexOf(HandCategory.Straight))
  })

  it('rejects hands of the wrong size', () => {
    expect(() => evaluate(parseCards('AhKh'))).toThrow(RangeError)
    expect(() => evaluateOmaha(parseCards('Ah'), parseCards('2c3c4c'))).toThrow(RangeError)
  })
})

describe('describeValue', () => {
  const d = (text: string) => describeValue(evaluate(parseCards(text)))
  it('names every category', () => {
    expect(d('AhKd9c7s2h')).toBe('High Card, Ace')
    expect(d('AhAd9c7s2h')).toBe('Pair of Aces')
    expect(d('AhAd9c9s2h')).toBe('Two Pair, Aces and Nines')
    expect(d('5h5d5c9s2h')).toBe('Three of a Kind, Fives')
    expect(d('Ah2d3c4s5h')).toBe('Straight, Five high')
    expect(d('AhJh9h7h2h')).toBe('Flush, Ace high')
    expect(d('5h5d5c9s9h')).toBe('Full House, Fives full of Nines')
    expect(d('5h5d5c5s9h')).toBe('Four of a Kind, Fives')
    expect(d('9hThJhQhKh')).toBe('Straight Flush, King high')
    expect(d('AhThJhQhKh')).toBe('Royal Flush')
    expect(CATEGORY_NAMES).toHaveLength(9)
  })
})
