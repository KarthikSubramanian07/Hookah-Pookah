/**
 * Deliberately naive reference evaluator used only as a test oracle.
 * It shares no code or tables with src/engine/evaluator.ts: it sorts five cards, counts ranks,
 * and brute-forces every five-card subset. Slow and obviously correct.
 */

import { HandCategory as C, type HandCategory } from '../src/engine/evaluator.ts'

export interface RefRules {
  /** Lowest rank in the deck: 0 for 52 cards, 4 for short deck. */
  lowRank: number
  /** Categories from weakest to strongest. */
  ranking: HandCategory[]
}

export const REF_STANDARD: RefRules = {
  lowRank: 0,
  ranking: [C.HighCard, C.Pair, C.TwoPair, C.Trips, C.Straight, C.Flush, C.FullHouse, C.Quads, C.StraightFlush],
}
export const REF_SHORT_TRITON: RefRules = {
  lowRank: 4,
  ranking: [C.HighCard, C.Pair, C.TwoPair, C.Straight, C.Trips, C.FullHouse, C.Flush, C.Quads, C.StraightFlush],
}
export const REF_SHORT_CLASSIC: RefRules = {
  lowRank: 4,
  ranking: [C.HighCard, C.Pair, C.TwoPair, C.Trips, C.Straight, C.FullHouse, C.Flush, C.Quads, C.StraightFlush],
}

export interface RefResult {
  category: HandCategory
  /** Tiebreak ranks, most significant first. */
  ranks: number[]
}

function straightHigh(distinctDesc: number[], lowRank: number): number {
  if (distinctDesc.length !== 5) return -1
  if (distinctDesc[0] - distinctDesc[4] === 4) return distinctDesc[0]
  const wheel = [12, lowRank + 3, lowRank + 2, lowRank + 1, lowRank]
  if (distinctDesc.every((r, i) => r === wheel[i])) return lowRank + 3
  return -1
}

export function refEval5(cards: number[], rules: RefRules): RefResult {
  const ranks = cards.map((c) => c >> 2)
  const suits = cards.map((c) => c & 3)
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  // Groups sorted by (count desc, rank desc).
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const byGroup = groups.map((g) => g[0])
  const isFlush = suits.every((s) => s === suits[0])
  const distinct = [...counts.keys()].sort((a, b) => b - a)
  const sHigh = straightHigh(distinct, rules.lowRank)

  if (isFlush && sHigh >= 0) return { category: C.StraightFlush, ranks: [sHigh] }
  if (groups[0][1] === 4) return { category: C.Quads, ranks: byGroup }
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: C.FullHouse, ranks: byGroup }
  if (isFlush) return { category: C.Flush, ranks: distinct }
  if (sHigh >= 0) return { category: C.Straight, ranks: [sHigh] }
  if (groups[0][1] === 3) return { category: C.Trips, ranks: byGroup }
  if (groups[0][1] === 2 && groups[1][1] === 2) return { category: C.TwoPair, ranks: byGroup }
  if (groups[0][1] === 2) return { category: C.Pair, ranks: byGroup }
  return { category: C.HighCard, ranks: distinct }
}

export function refCompare(a: RefResult, b: RefResult, rules: RefRules): number {
  const ca = rules.ranking.indexOf(a.category)
  const cb = rules.ranking.indexOf(b.category)
  if (ca !== cb) return ca - cb
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const d = (a.ranks[i] ?? -1) - (b.ranks[i] ?? -1)
    if (d !== 0) return d
  }
  return 0
}

export function* combinations<T>(items: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc]
    return
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i])
    yield* combinations(items, k, i + 1, acc)
    acc.pop()
  }
}

export function refEvalBest(cards: number[], rules: RefRules): RefResult {
  let best: RefResult | undefined
  for (const five of combinations(cards, 5)) {
    const r = refEval5(five, rules)
    if (!best || refCompare(r, best, rules) > 0) best = r
  }
  return best!
}

export function refEvalOmaha(hole: number[], board: number[], rules: RefRules): RefResult {
  let best: RefResult | undefined
  for (const two of combinations(hole, 2))
    for (const three of combinations(board, 3)) {
      const r = refEval5([...two, ...three], rules)
      if (!best || refCompare(r, best, rules) > 0) best = r
    }
  return best!
}

// ---------------------------------------------------------------------------------------------
// Brute-force equity oracle
// ---------------------------------------------------------------------------------------------

export interface RefScenario {
  lowRank: number
  rules: RefRules
  omaha: boolean
  holeCount: number
  board: number[]
  dead: number[]
  /** Per player: known cards (possibly partial) or a weighted range of full holdings. */
  players: { cards?: number[]; range?: { cards: number[]; weight: number }[] }[]
}

export interface RefEquity {
  equity: number[]
  win: number[]
  tie: number[]
  categories: number[][]
  totalWeight: number
}

/**
 * Enumerates every deal with nested generators and scores it with the naive evaluator.
 * Only suitable for small scenarios (late streets, few unknown cards).
 */
export function refEquity(s: RefScenario): RefEquity {
  const n = s.players.length
  const eq = new Array(n).fill(0)
  const win = new Array(n).fill(0)
  const tie = new Array(n).fill(0)
  const cats = Array.from({ length: n }, () => new Array(9).fill(0))
  let total = 0
  const fixed = new Set<number>([...s.board, ...s.dead, ...s.players.flatMap((p) => p.cards ?? [])])
  const deck: number[] = []
  for (let c = s.lowRank * 4; c < 52; c++) if (!fixed.has(c)) deck.push(c)

  const holes: number[][] = s.players.map((p) => [...(p.cards ?? [])])
  const rec = (p: number, used: Set<number>, weight: number) => {
    if (p === n) {
      const avail = deck.filter((c) => !used.has(c))
      for (const run of combinations(avail, 5 - s.board.length)) {
        const board = [...s.board, ...run]
        const results = holes.map((h) => (s.omaha ? refEvalOmaha(h, board, s.rules) : refEvalBest([...h, ...board], s.rules)))
        let best = results[0]
        for (const r of results) if (refCompare(r, best, s.rules) > 0) best = r
        const winners = results.filter((r) => refCompare(r, best, s.rules) === 0).length
        results.forEach((r, i) => {
          cats[i][r.category] += weight
          if (refCompare(r, best, s.rules) === 0) {
            eq[i] += weight / winners
            if (winners === 1) win[i] += weight
            else tie[i] += weight
          }
        })
        total += weight
      }
      return
    }
    const player = s.players[p]
    if (player.range) {
      for (const combo of player.range) {
        if (combo.cards.some((c) => used.has(c) || fixed.has(c))) continue
        holes[p] = combo.cards
        combo.cards.forEach((c) => used.add(c))
        rec(p + 1, used, weight * combo.weight)
        combo.cards.forEach((c) => used.delete(c))
      }
      return
    }
    const known = player.cards ?? []
    const need = s.holeCount - known.length
    const avail = deck.filter((c) => !used.has(c))
    for (const extra of combinations(avail, need)) {
      holes[p] = [...known, ...extra]
      extra.forEach((c) => used.add(c))
      rec(p + 1, used, weight)
      extra.forEach((c) => used.delete(c))
    }
  }
  rec(0, new Set(), 1)
  return {
    equity: eq.map((x) => x / total),
    win: win.map((x) => x / total),
    tie: tie.map((x) => x / total),
    categories: cats.map((row) => row.map((x) => x / total)),
    totalWeight: total,
  }
}
