import { describe, expect, it } from 'vitest'
import { RULES_SHORT_CLASSIC, RULES_SHORT_TRITON, RULES_STANDARD, type Rules, evaluate, evaluateOmaha } from '../src/engine/evaluator.ts'
import { Rng } from '../src/engine/rng.ts'
import { FastScorer } from '../src/engine/scorer.ts'

function deal(rng: Rng, lowRank: number, k: number): number[] {
  const deck: number[] = []
  for (let c = lowRank * 4; c < 52; c++) deck.push(c)
  for (let i = 0; i < k; i++) {
    const j = i + rng.nextInt(deck.length - i)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.slice(0, k)
}

describe('FastScorer', () => {
  const holdem: [string, Rules, number][] = [
    ['standard', RULES_STANDARD, 0],
    ['short deck triton', RULES_SHORT_TRITON, 4],
    ['short deck classic', RULES_SHORT_CLASSIC, 4],
  ]
  for (const [name, rules, low] of holdem) {
    it(`matches the mask evaluator value for value (${name})`, () => {
      const rng = new Rng(31 + low)
      const n = 4
      const scorer = new FastScorer(rules, n, 2, false)
      const hole = new Int32Array(n * 2)
      const board = new Int32Array(5)
      const values = new Int32Array(n)
      for (let t = 0; t < 40_000; t++) {
        const cards = deal(rng, low, n * 2 + 5)
        for (let i = 0; i < n * 2; i++) hole[i] = cards[i]
        for (let i = 0; i < 5; i++) board[i] = cards[n * 2 + i]
        for (let p = 0; p < n; p++) scorer.setPlayer(p, hole)
        scorer.score(board, values)
        for (let p = 0; p < n; p++) {
          const expected = evaluate([hole[p * 2], hole[p * 2 + 1], ...board], rules)
          if (values[p] !== expected) throw new Error(`Mismatch ${name}: ${[...cards]}`)
        }
      }
      expect(true).toBe(true)
    })
  }

  for (const hc of [4, 5]) {
    it(`matches brute-force Omaha value for value (${hc} hole cards)`, () => {
      const rng = new Rng(900 + hc)
      const n = 3
      const scorer = new FastScorer(RULES_STANDARD, n, hc, true)
      const hole = new Int32Array(n * hc)
      const board = new Int32Array(5)
      const values = new Int32Array(n)
      for (let t = 0; t < 30_000; t++) {
        // Every third deal uses a narrow deck to force paired boards, trips, boats and quads.
        const low = t % 3 === 0 ? 7 : 0
        const cards = deal(rng, low, Math.min(n * hc + 5, 52 - low * 4))
        if (cards.length < n * hc + 5) continue
        for (let i = 0; i < n * hc; i++) hole[i] = cards[i]
        for (let i = 0; i < 5; i++) board[i] = cards[n * hc + i]
        for (let p = 0; p < n; p++) scorer.setPlayer(p, hole)
        scorer.score(board, values)
        for (let p = 0; p < n; p++) {
          const expected = evaluateOmaha([...hole.slice(p * hc, p * hc + hc)], [...board])
          if (values[p] !== expected) throw new Error(`Omaha mismatch: ${[...cards]}`)
        }
      }
      expect(true).toBe(true)
    })
  }
})
