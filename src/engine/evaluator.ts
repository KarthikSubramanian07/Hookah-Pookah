/**
 * Bitmask hand evaluator.
 *
 * Cards are folded into four 13-bit suit masks (clubs, diamonds, hearts, spades). Straights,
 * flushes and rank multiplicities are then read straight off the masks with a handful of 8192-entry
 * tables, the approach popularised by pokersource's poker-eval (StdDeck_StdRules_EVAL_N).
 * Works for any 5, 6 or 7 card holding and needs well under 100 KB of tables, all built at startup.
 *
 * A hand value is a positive int32 where a larger value is a stronger hand:
 *
 *   bits 24..27  strength order of the category under the active rules
 *   bits 20..23  category id (HandCategory), so the category survives rule-specific reordering
 *   bits  0..19  up to five 4-bit rank nibbles, most significant first
 */

import type { Card } from './cards.ts'
import { RANK_NAMES, rankOf, suitOf } from './cards.ts'
import type { ShortDeckRules, VariantId } from './variants.ts'

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory]

export const CATEGORY_COUNT = 9

export const CATEGORY_NAMES: readonly string[] = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
]

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

const MASKS = 1 << 13

/** Number of set bits. */
export const POPCOUNT = new Uint8Array(MASKS)
/** Index of the highest set bit (0 for an empty mask). */
export const TOP_BIT = new Uint8Array(MASKS)
/** Top five set bits packed as nibbles r1<<16 | r2<<12 | r3<<8 | r4<<4 | r5. */
export const TOP_FIVE = new Uint32Array(MASKS)

for (let m = 1; m < MASKS; m++) {
  POPCOUNT[m] = POPCOUNT[m >> 1] + (m & 1)
  TOP_BIT[m] = 31 - Math.clz32(m)
  let packed = 0
  let rest = m
  for (let i = 0; i < 5 && rest; i++) {
    const top = 31 - Math.clz32(rest)
    packed |= top << (16 - 4 * i)
    rest ^= 1 << top
  }
  TOP_FIVE[m] = packed
}

/** For each rank mask, 1 + the rank of the highest straight it contains, or 0. */
function buildStraightTable(lowRank: number): Uint8Array {
  const table = new Uint8Array(MASKS)
  const ACE = 1 << 12
  // Lowest straight is the "wheel": ace plays low below the four lowest ranks in the deck.
  const wheel = ACE | (0b1111 << lowRank)
  const wheelHigh = lowRank + 3
  for (let m = 0; m < MASKS; m++) {
    let high = 0
    for (let top = 12; top >= lowRank + 4; top--) {
      const run = 0b11111 << (top - 4)
      if ((m & run) === run) {
        high = top + 1
        break
      }
    }
    if (!high && (m & wheel) === wheel) high = wheelHigh + 1
    table[m] = high
  }
  return table
}

export const STRAIGHT_STANDARD = buildStraightTable(0)
export const STRAIGHT_SHORT = buildStraightTable(4)

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

/** order[category] = strength position of that category (0 weakest, 8 strongest). */
export type CategoryOrder = readonly number[]

const C = HandCategory
function orderFrom(weakestToStrongest: HandCategory[]): CategoryOrder {
  const order = new Array<number>(CATEGORY_COUNT)
  weakestToStrongest.forEach((cat, i) => (order[cat] = i))
  return order
}

export const ORDER_STANDARD = orderFrom([
  C.HighCard,
  C.Pair,
  C.TwoPair,
  C.Trips,
  C.Straight,
  C.Flush,
  C.FullHouse,
  C.Quads,
  C.StraightFlush,
])

/** Triton / GGPoker short deck: trips beat straights, flushes beat full houses. */
export const ORDER_SHORT_TRITON = orderFrom([
  C.HighCard,
  C.Pair,
  C.TwoPair,
  C.Straight,
  C.Trips,
  C.FullHouse,
  C.Flush,
  C.Quads,
  C.StraightFlush,
])

/** Classic short deck: standard ordering except flushes beat full houses. */
export const ORDER_SHORT_CLASSIC = orderFrom([
  C.HighCard,
  C.Pair,
  C.TwoPair,
  C.Trips,
  C.Straight,
  C.FullHouse,
  C.Flush,
  C.Quads,
  C.StraightFlush,
])

/** Evaluates suit masks holding `n` cards (5 <= n <= 7). */
export type MaskEvaluator = (c: number, d: number, h: number, s: number, n: number) => number

export interface Rules {
  key: string
  order: CategoryOrder
  /** Categories from weakest to strongest under these rules. */
  ranking: readonly HandCategory[]
  lowRank: number
  evalMasks: MaskEvaluator
}

export function makeMaskEvaluator(straight: Uint8Array, order: CategoryOrder): MaskEvaluator {
  const base = order.map((o, cat) => (o << 24) | (cat << 20))
  const HIGH = base[C.HighCard]
  const PAIR = base[C.Pair]
  const TWO_PAIR = base[C.TwoPair]
  const TRIPS = base[C.Trips]
  const STRAIGHT = base[C.Straight]
  const FLUSH = base[C.Flush]
  const FULL_HOUSE = base[C.FullHouse]
  const QUADS = base[C.Quads]
  const STRAIGHT_FLUSH = base[C.StraightFlush]
  const POP = POPCOUNT
  const TOP = TOP_BIT
  const TOP5 = TOP_FIVE

  return (c, d, h, s, n) => {
    const ranks = c | d | h | s
    const nRanks = POP[ranks]
    let best = 0

    // With at most 7 cards only one suit can hold five or more.
    const flush = POP[c] >= 5 ? c : POP[d] >= 5 ? d : POP[h] >= 5 ? h : POP[s] >= 5 ? s : 0
    if (flush) {
      const sf = straight[flush]
      if (sf) return STRAIGHT_FLUSH | (sf - 1)
      best = FLUSH | TOP5[flush]
    }
    if (nRanks >= 5) {
      const st = straight[ranks]
      if (st) {
        const v = STRAIGHT | (st - 1)
        if (v > best) best = v
      }
      if (nRanks === n) return best || HIGH | TOP5[ranks]
    }

    const quads = c & d & h & s
    if (quads) {
      const q = TOP[quads]
      const v = QUADS | (q << 16) | (TOP[ranks ^ (1 << q)] << 12)
      return v > best ? v : best
    }

    // Ranks held three or more times (quads already handled) and exactly twice.
    const trips = ((c & d) | (h & s)) & ((c & h) | (d & s))
    const pairs = ranks ^ (c ^ d ^ h ^ s)

    let v: number
    if (trips) {
      const t = TOP[trips]
      const filler = (trips ^ (1 << t)) | pairs
      if (filler) v = FULL_HOUSE | (t << 16) | (TOP[filler] << 12)
      else v = TRIPS | (t << 16) | ((TOP5[ranks ^ (1 << t)] >> 4) & 0xff00)
    } else {
      const p1 = TOP[pairs]
      const others = pairs ^ (1 << p1)
      if (others) {
        const p2 = TOP[others]
        v = TWO_PAIR | (p1 << 16) | (p2 << 12) | (TOP[ranks ^ (1 << p1) ^ (1 << p2)] << 8)
      } else {
        v = PAIR | (p1 << 16) | ((TOP5[ranks ^ (1 << p1)] >> 4) & 0xfff0)
      }
    }
    return v > best ? v : best
  }
}

function makeRules(key: string, straight: Uint8Array, order: CategoryOrder, lowRank: number): Rules {
  const ranking = [...Array(CATEGORY_COUNT).keys()].sort((a, b) => order[a] - order[b]) as HandCategory[]
  return { key, order, ranking, lowRank, evalMasks: makeMaskEvaluator(straight, order) }
}

export const RULES_STANDARD = makeRules('standard', STRAIGHT_STANDARD, ORDER_STANDARD, 0)
export const RULES_SHORT_TRITON = makeRules('short-triton', STRAIGHT_SHORT, ORDER_SHORT_TRITON, 4)
export const RULES_SHORT_CLASSIC = makeRules('short-classic', STRAIGHT_SHORT, ORDER_SHORT_CLASSIC, 4)

export function rulesFor(variant: VariantId, shortDeckRules: ShortDeckRules = 'triton'): Rules {
  if (variant !== 'shortdeck') return RULES_STANDARD
  return shortDeckRules === 'classic' ? RULES_SHORT_CLASSIC : RULES_SHORT_TRITON
}

// ---------------------------------------------------------------------------------------------
// Convenience wrappers (not used in hot loops)
// ---------------------------------------------------------------------------------------------

/** Evaluates the best five-card hand from 5 to 7 cards. */
export function evaluate(cards: readonly Card[], rules: Rules = RULES_STANDARD): number {
  if (cards.length < 5 || cards.length > 7) throw new RangeError(`evaluate expects 5 to 7 cards, got ${cards.length}`)
  const m = [0, 0, 0, 0]
  for (const card of cards) m[suitOf(card)] |= 1 << rankOf(card)
  return rules.evalMasks(m[0], m[1], m[2], m[3], cards.length)
}

/** Omaha: the best hand using exactly two hole cards and exactly three board cards. */
export function evaluateOmaha(hole: readonly Card[], board: readonly Card[], rules: Rules = RULES_STANDARD): number {
  if (hole.length < 2 || board.length < 3) throw new RangeError('Omaha needs at least 2 hole cards and 3 board cards')
  let best = 0
  for (let a = 0; a < hole.length; a++)
    for (let b = a + 1; b < hole.length; b++)
      for (let x = 0; x < board.length; x++)
        for (let y = x + 1; y < board.length; y++)
          for (let z = y + 1; z < board.length; z++) {
            const v = evaluate([hole[a], hole[b], board[x], board[y], board[z]], rules)
            if (v > best) best = v
          }
  return best
}

export const categoryOf = (value: number): HandCategory => ((value >> 20) & 0xf) as HandCategory

const nibble = (value: number, i: number): number => (value >> (16 - 4 * i)) & 0xf

const PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces']

/** Human readable description, e.g. "Full House, Kings full of Sevens". */
export function describeValue(value: number): string {
  const cat = categoryOf(value)
  const r = (i: number) => RANK_NAMES[nibble(value, i)]
  const p = (i: number) => PLURAL[nibble(value, i)]
  switch (cat) {
    case C.HighCard:
      return `High Card, ${r(0)}`
    case C.Pair:
      return `Pair of ${p(0)}`
    case C.TwoPair:
      return `Two Pair, ${p(0)} and ${p(1)}`
    case C.Trips:
      return `Three of a Kind, ${p(0)}`
    case C.Straight:
      return `Straight, ${RANK_NAMES[value & 0xf]} high`
    case C.Flush:
      return `Flush, ${r(0)} high`
    case C.FullHouse:
      return `Full House, ${p(0)} full of ${p(1)}`
    case C.Quads:
      return `Four of a Kind, ${p(0)}`
    default:
      return (value & 0xf) === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[value & 0xf]} high`
  }
}
