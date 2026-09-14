/**
 * Showdown scorer: OMPEval-style lookups for Hold'em and short deck, and the direct Omaha evaluator
 * (no loop over the 60 / 100 two-plus-three subsets) for PLO4 and PLO5.
 * Produces exactly the same values as the current Table.showdown, so every downstream accumulator,
 * category histogram and tie rule is untouched.
 *
 * Integration (equity.ts, class Table):
 *   constructor:     this.scorer = new FastScorer(prep.rules, this.n, prep.holeCount, prep.mustUseTwo)
 *   refreshPlayer(p): this.scorer.setPlayer(p, this.hole)      (replaces the mask building)
 *   showdown(weight): this.scorer.score(this.boardCards, this.values)  (replaces the evaluation block)
 */

import type { Rules } from './evaluator.ts'
import { CARD_BIT, CARD_KEY, CARD_SUIT, COUNTER_BIAS, FLUSH_CHECK, ROW_SHIFT, ompTables } from './omp.ts'
import { OmahaBoard, omahaValue } from './omaha.ts'

export class FastScorer {
  readonly n: number
  readonly holeCount: number
  readonly mustUseTwo: boolean
  private readonly lookup: Int32Array
  private readonly offsets: Int32Array
  private readonly flush: Int32Array
  /** Hold'em: rank key and suit counters per player. */
  private readonly hKey: Int32Array
  private readonly hCnt: Int32Array
  /** Per player suit masks [c, d, h, s] (flush lookups and Omaha). */
  private readonly hMask: Int32Array
  /** Omaha: ranks held once or more (p1) and twice or more (p2). */
  private readonly p1: Int32Array
  private readonly p2: Int32Array
  private readonly board = new OmahaBoard()

  constructor(rules: Rules, n: number, holeCount: number, mustUseTwo: boolean) {
    this.n = n
    this.holeCount = holeCount
    this.mustUseTwo = mustUseTwo
    const t = ompTables(rules)
    this.lookup = t.lookup
    this.offsets = t.offsets
    this.flush = t.flush
    this.hKey = new Int32Array(n)
    this.hCnt = new Int32Array(n)
    this.hMask = new Int32Array(n * 4)
    this.p1 = new Int32Array(n)
    this.p2 = new Int32Array(n)
  }

  /** Recomputes player p's cached state from hole[p * holeCount ...]. */
  setPlayer(p: number, hole: Int32Array): void {
    const hc = this.holeCount
    const base = p * hc
    const o = p * 4
    const hm = this.hMask
    hm[o] = hm[o + 1] = hm[o + 2] = hm[o + 3] = 0
    let key = 0
    let cnt = 0
    for (let i = 0; i < hc; i++) {
      const card = hole[base + i]
      key += CARD_KEY[card]
      cnt += CARD_SUIT[card]
      hm[o + (card & 3)] |= CARD_BIT[card]
    }
    this.hKey[p] = key
    this.hCnt[p] = cnt
    const c = hm[o]
    const d = hm[o + 1]
    const h = hm[o + 2]
    const s = hm[o + 3]
    this.p1[p] = c | d | h | s
    this.p2[p] = (c & d) | (c & h) | (c & s) | (d & h) | (d & s) | (h & s)
  }

  /** Writes every player's hand value for the 5 card board `bc` into `values`. */
  score(bc: Int32Array, values: Int32Array): void {
    const n = this.n
    const hm = this.hMask
    if (!this.mustUseTwo) {
      const L = this.lookup
      const O = this.offsets
      const F = this.flush
      const c0 = bc[0]
      const c1 = bc[1]
      const c2 = bc[2]
      const c3 = bc[3]
      const c4 = bc[4]
      const key = CARD_KEY[c0] + CARD_KEY[c1] + CARD_KEY[c2] + CARD_KEY[c3] + CARD_KEY[c4]
      const cnt = COUNTER_BIAS + CARD_SUIT[c0] + CARD_SUIT[c1] + CARD_SUIT[c2] + CARD_SUIT[c3] + CARD_SUIT[c4]
      for (let p = 0; p < n; p++) {
        const fl = (cnt + this.hCnt[p]) & FLUSH_CHECK
        if (fl === 0) {
          const k = key + this.hKey[p]
          values[p] = L[k + O[k >>> ROW_SHIFT]]
        } else {
          const suit = (31 - Math.clz32(fl)) >> 2
          let m = hm[p * 4 + suit]
          if ((c0 & 3) === suit) m |= CARD_BIT[c0]
          if ((c1 & 3) === suit) m |= CARD_BIT[c1]
          if ((c2 & 3) === suit) m |= CARD_BIT[c2]
          if ((c3 & 3) === suit) m |= CARD_BIT[c3]
          if ((c4 & 3) === suit) m |= CARD_BIT[c4]
          values[p] = F[m]
        }
      }
      return
    }
    let c = 0
    let d = 0
    let h = 0
    let s = 0
    for (let i = 0; i < 5; i++) {
      const card = bc[i]
      const bit = CARD_BIT[card]
      const suit = card & 3
      if (suit === 0) c |= bit
      else if (suit === 1) d |= bit
      else if (suit === 2) h |= bit
      else s |= bit
    }
    const bd = this.board
    bd.set(c, d, h, s)
    const fs = bd.flushSuit
    const p1 = this.p1
    const p2 = this.p2
    if (fs < 0) for (let p = 0; p < n; p++) values[p] = omahaValue(bd, p1[p], p2[p], 0)
    else for (let p = 0; p < n; p++) values[p] = omahaValue(bd, p1[p], p2[p], hm[p * 4 + fs])
  }
}
