/**
 * Direct Omaha (PLO4 / PLO5) evaluator: no loop over the 60 / 100 two-plus-three card subsets.
 * After Open PQL's case analysis (openpql-prelude/src/eval/rating/omaha.rs, MIT), rewritten to emit
 * Hookah-Pookah's exact hand value encoding (category order << 24 | category << 20 | rank nibbles),
 * and to compare candidate hands by full value (kickers included) instead of PQL's top-rank-only max.
 *
 * Inputs are 13 bit rank masks: player ranks held >= 1 time (p1) and >= 2 times (p2), per suit hole
 * masks, and board ranks held >= 1 / >= 2 / >= 3 times plus the board's flush suit (the only suit with
 * three or more board cards, if any). Only valid for 5 card boards (the showdown case).
 */

import { TOP_FIVE, POPCOUNT } from './evaluator.ts'

const SF = (8 << 24) | (8 << 20)
const QUADS = (7 << 24) | (7 << 20)
const FULL = (6 << 24) | (6 << 20)
const FLUSH = (5 << 24) | (5 << 20)
const STRAIGHT = (4 << 24) | (4 << 20)
const TRIPS = (3 << 24) | (3 << 20)
const TWO_PAIR = (2 << 24) | (2 << 20)
const PAIR = (1 << 24) | (1 << 20)

/** Highest set bit as a mask (0 for 0). */
const HB = new Uint16Array(8192)
/** Highest set bit index. */
const HI = new Int8Array(8192)
for (let m = 1; m < 8192; m++) {
  HI[m] = 31 - Math.clz32(m)
  HB[m] = 1 << HI[m]
}
const POP = POPCOUNT
const TOP5 = TOP_FIVE

/** Straight windows, highest first; the wheel (A2345) last with high card index 3. */
const WINDOWS = new Int32Array(10)
const WINDOW_HIGH = new Int32Array(10)
for (let i = 0; i < 9; i++) {
  WINDOWS[i] = 0b11111 << (8 - i)
  WINDOW_HIGH[i] = 12 - i
}
WINDOWS[9] = (1 << 12) | 0b1111
WINDOW_HIGH[9] = 3

/** Best straight high card (or -1) using >= 2 ranks from `hole` and >= 3 ranks from `board`. */
function straightHigh(hole: number, board: number): number {
  const both = hole | board
  for (let i = 0; i < 10; i++) {
    const w = WINDOWS[i]
    if ((w & both) === w && POP[w & hole] >= 2 && POP[w & board] >= 3) return WINDOW_HIGH[i]
  }
  return -1
}

/**
 * Board-level precomputation shared by every player at one showdown.
 * Straight candidates: windows with >= 3 board ranks (others can never be completed).
 */
export class OmahaBoard {
  b1 = 0
  b2 = 0
  b3 = 0
  /** Suit with >= 3 board cards, or -1. */
  flushSuit = -1
  flushBoard = 0
  /** Straight windows with at least 3 board ranks, highest first. */
  readonly win = new Int32Array(10)
  readonly winHigh = new Int32Array(10)
  winCount = 0

  set(c: number, d: number, h: number, s: number): void {
    const b1 = c | d | h | s
    this.b1 = b1
    this.b2 = (c & d) | (c & h) | (c & s) | (d & h) | (d & s) | (h & s)
    this.b3 = (c & d & h) | (c & d & s) | (c & h & s) | (d & h & s)
    this.flushSuit = POP[c] >= 3 ? 0 : POP[d] >= 3 ? 1 : POP[h] >= 3 ? 2 : POP[s] >= 3 ? 3 : -1
    this.flushBoard = this.flushSuit === 0 ? c : this.flushSuit === 1 ? d : this.flushSuit === 2 ? h : this.flushSuit === 3 ? s : 0
    let n = 0
    for (let i = 0; i < 10; i++) {
      if (POP[WINDOWS[i] & b1] >= 3) {
        this.win[n] = WINDOWS[i]
        this.winHigh[n] = WINDOW_HIGH[i]
        n++
      }
    }
    this.winCount = n
  }
}

/**
 * Omaha value for one player against a prepared board.
 * p1: ranks the player holds, p2: ranks held twice or more, hs: the player's hole mask in the board's
 * flush suit (pass 0 when the board has no flush suit).
 */
export function omahaValue(bd: OmahaBoard, p1: number, p2: number, hs: number): number {
  const b1 = bd.b1
  const b2 = bd.b2
  const b3 = bd.b3
  let best = 0
  let v = 0

  // Flush and straight flush: exactly one suit can hold three board cards.
  if (bd.flushSuit >= 0 && POP[hs] >= 2) {
    const fb = bd.flushBoard
    const sf = straightHigh(hs, fb)
    if (sf >= 0) return SF | sf
    const h1 = HB[hs]
    const t1 = HB[fb]
    const t2 = HB[fb ^ t1]
    best = FLUSH | TOP5[h1 | HB[hs ^ h1] | t1 | t2 | HB[fb ^ t1 ^ t2]]
  }

  // Quads.
  let x = p2 & b2
  if (x) {
    const q = HI[x]
    v = QUADS | (q << 16) | (HI[b1 & ~(1 << q)] << 12)
  }
  x = p1 & b3
  if (x) {
    const q = HI[x]
    const w = QUADS | (q << 16) | (HI[p1 & ~(1 << q)] << 12)
    if (w > v) v = w
  }
  if (v) return v > best ? v : best

  // Full house.
  if (b3 && p2) {
    const t = HI[b3]
    v = FULL | (t << 16) | (HI[p2 & ~(1 << t)] << 12)
  }
  x = p2 & b1
  if (x) {
    const t = HI[x]
    const lo = b2 & ~(1 << t)
    if (lo) {
      const w = FULL | (t << 16) | (HI[lo] << 12)
      if (w > v) v = w
    }
  }
  x = b2 & p1
  if (x) {
    const t = HI[x]
    const lo = b1 & ~(1 << t) & p1
    if (lo) {
      const w = FULL | (t << 16) | (HI[lo] << 12)
      if (w > v) v = w
    }
  }
  if (v) return v > best ? v : best
  if (best) return best // flush beats everything below

  // Straight.
  const both = p1 | b1
  for (let i = 0, n = bd.winCount; i < n; i++) {
    const w = bd.win[i]
    if ((w & both) === w && POP[w & p1] >= 2) return STRAIGHT | bd.winHigh[i]
  }

  // Trips.
  if (b3) {
    const h1 = HB[p1]
    v = TRIPS | (HI[b3] << 16) | (TOP5[h1 | HB[p1 ^ h1]] >> 4)
  }
  x = b2 & p1
  if (x) {
    const t = HI[x]
    const tb = 1 << t
    const w = TRIPS | (t << 16) | (TOP5[HB[b1 & ~tb] | HB[p1 & ~tb]] >> 4)
    if (w > v) v = w
  }
  x = p2 & b1
  if (x) {
    const t = HI[x]
    const rest = b1 & ~(1 << t)
    const k1 = HB[rest]
    const w = TRIPS | (t << 16) | (TOP5[k1 | HB[rest ^ k1]] >> 4)
    if (w > v) v = w
  }
  if (v) return v

  // Two pair.
  if (p2 && b2) {
    const a = HB[p2]
    const b = HB[b2]
    const pairs = a | b
    v = TWO_PAIR | TOP5[pairs] | (HI[b1 & ~pairs] << 8)
  }
  const pb = p1 & b1
  if (pb && b2) {
    const pairs = HB[pb] | HB[b2]
    const w = TWO_PAIR | TOP5[pairs] | (HI[p1 & ~pairs] << 8)
    if (w > v) v = w
  }
  if (POP[pb] >= 2) {
    const a = HB[pb]
    const pairs = a | HB[pb ^ a]
    const w = TWO_PAIR | TOP5[pairs] | (HI[b1 & ~pairs] << 8)
    if (w > v) v = w
  }
  if (v) return v

  // One pair.
  if (b2) {
    const a = HI[b2]
    const h1 = HB[p1]
    v = PAIR | (a << 16) | (TOP5[HB[b1 & ~(1 << a)] | h1 | HB[p1 ^ h1]] >> 4)
  }
  if (pb) {
    const a = HI[pb]
    const ab = 1 << a
    const rest = b1 & ~ab
    const k1 = HB[rest]
    const w = PAIR | (a << 16) | (TOP5[k1 | HB[rest ^ k1] | HB[p1 & ~ab]] >> 4)
    if (w > v) v = w
  }
  if (p2) {
    const a = HI[p2]
    const k1 = HB[b1]
    const k2 = HB[b1 ^ k1]
    const w = PAIR | (a << 16) | (TOP5[k1 | k2 | HB[b1 ^ k1 ^ k2]] >> 4)
    if (w > v) v = w
  }
  if (v) return v

  // High card: best three board ranks and best two hole ranks (all distinct here).
  const k1 = HB[b1]
  const k2 = HB[b1 ^ k1]
  const h1 = HB[p1]
  return TOP5[k1 | k2 | HB[b1 ^ k1 ^ k2] | h1 | HB[p1 ^ h1]]
}


