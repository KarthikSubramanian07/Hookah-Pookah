/**
 * OMPEval-style 5..7 card evaluator, after zekyll/OMPEval (ISC) (rank multiplier keys + displacement perfect hash + flush table).
 *
 * The tables are filled by calling the existing mask evaluator once per rank multiset and once per
 * flush suit mask, so every value is IDENTICAL to `rules.evalMasks` (verified exhaustively over all
 * 5, 6 and 7 card hands for standard, short-deck triton and short-deck classic rules). Build time is
 * about 20 ms per rule set; memory is 332 KB (lookup) + 33 KB (offsets) + 33 KB (flush).
 *
 * Hand state is additive, so it can be cached per player and per partial board:
 *   key  = sum of CARD_KEY[card]                       (unique for each 0..7 card rank multiset)
 *   cnt  = COUNTER_BIAS + sum of CARD_SUIT[card]       (nibble per suit, bit 3 set once a suit has 5)
 * Evaluate:
 *   fl = cnt & FLUSH_CHECK
 *   fl === 0 ? LOOKUP[key + OFFSETS[key >>> 12]] : FLUSH[suitMask[(31 - Math.clz32(fl)) >> 2]]
 */

import type { Rules } from './evaluator.ts'
import { OMP_OFFSETS_B64 } from './ompOffsets.ts'

/** OMPEval rank multipliers (zekyll/OMPEval, ISC licence): every 0..7 card rank multiset (max 4 per rank) has a unique sum. */
const RANK_MUL = [0x2000, 0x8001, 0x11000, 0x3a000, 0x91000, 0x176005, 0x366000, 0x41a013, 0x47802e, 0x479068, 0x48c0e4, 0x48f211, 0x494493]
export const ROW_SHIFT = 12
export const COUNTER_BIAS = 0x3333
export const FLUSH_CHECK = 0x8888

/** Per card id (rank * 4 + suit) constants. */
export const CARD_KEY = new Int32Array(52)
export const CARD_SUIT = new Int32Array(52)
export const CARD_BIT = new Int32Array(52)
for (let c = 0; c < 52; c++) {
  CARD_KEY[c] = RANK_MUL[c >> 2]
  CARD_SUIT[c] = 1 << (4 * (c & 3))
  CARD_BIT[c] = 1 << (c >> 2)
}

export interface OmpTables {
  readonly lookup: Int32Array
  readonly offsets: Int32Array
  readonly flush: Int32Array
}

let offsetsCache: Int32Array | undefined
function offsets(): Int32Array {
  if (!offsetsCache) {
    const bin = atob(OMP_OFFSETS_B64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    offsetsCache = new Int32Array(bytes.buffer)
  }
  return offsetsCache
}

const tableCache = new Map<string, OmpTables>()

/** Tables for a rule set, built once per rule set (about 20 ms) and cached. */
export function ompTables(rules: Rules): OmpTables {
  const cached = tableCache.get(rules.key)
  if (cached) return cached
  const offs = offsets()
  const evalMasks = rules.evalMasks
  const counts = new Int8Array(13)
  const keys: number[] = []
  const vals: number[] = []
  let maxIndex = 0

  const visit = (n: number) => {
    const m = [0, 0, 0, 0]
    let key = 0
    let next = 0
    for (let r = 12; r >= 0; r--) {
      const k = counts[r]
      if (!k) continue
      key += k * RANK_MUL[r]
      // Round robin suits: copies of a rank get distinct suits and no suit gets more than 2 of 7 cards.
      for (let i = 0; i < k; i++) m[(next + i) & 3] |= 1 << r
      next = (next + k) & 3
    }
    const index = key + offs[key >>> ROW_SHIFT]
    if (index > maxIndex) maxIndex = index
    keys.push(index)
    vals.push(evalMasks(m[0], m[1], m[2], m[3], n))
  }
  const rec = (r: number, n: number) => {
    if (r === 13) {
      if (n >= 5) visit(n)
      return
    }
    for (let k = 0; k <= 4 && n + k <= 7; k++) {
      counts[r] = k
      rec(r + 1, n + k)
    }
    counts[r] = 0
  }
  rec(rules.lowRank, 0)

  const lookup = new Int32Array(maxIndex + 1)
  for (let i = 0; i < keys.length; i++) {
    // Offsets are collision free by construction; this guard turns a corrupted table into a loud failure.
    if (lookup[keys[i]] !== 0 && lookup[keys[i]] !== vals[i]) throw new Error('OMP perfect hash collision')
    lookup[keys[i]] = vals[i]
  }

  const flush = new Int32Array(8192)
  const deckMask = 0x1fff & ~((1 << rules.lowRank) - 1)
  for (let m = 0; m < 8192; m++) {
    if ((m & deckMask) !== m) continue
    let n = 0
    for (let x = m; x; x &= x - 1) n++
    if (n >= 5 && n <= 7) flush[m] = evalMasks(m, 0, 0, 0, n)
  }
  const tables = { lookup, offsets: offs, flush }
  tableCache.set(rules.key, tables)
  return tables
}
