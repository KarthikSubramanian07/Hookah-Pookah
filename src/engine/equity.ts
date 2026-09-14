/**
 * Equity engine.
 *
 * Every player is described by known hole cards (possibly none or only some) or by a weighted range.
 * Unknown cards are dealt uniformly from what is left of the deck. The engine answers with win, tie
 * and equity probabilities plus the distribution of final hand categories, either by exhaustively
 * enumerating every deal (exact) or by Monte Carlo sampling with a standard error.
 *
 * Correctness notes:
 *  - Ties split the pot: a player tied with k-1 others earns 1/k of that outcome's equity.
 *  - Range combos that collide with known cards are removed before anything else.
 *  - Joint range assignments with card conflicts are impossible deals, so the target distribution is
 *    uniform over conflict-free assignments weighted by the product of combo weights. Exact mode
 *    enumerates exactly that set. Monte Carlo samples it without bias, either from an enumerated list
 *    or by rejection sampling whole assignments (never player-by-player resampling, which is biased).
 *  - Every conflict-free range assignment leaves the same number of cards behind, so the number of
 *    completions (random hole cards and board runouts) is identical for each and needs no reweighting.
 */

import type { Card } from './cards.ts'
import { formatCard, rankOf, suitOf } from './cards.ts'
import { CATEGORY_COUNT, type Rules, categoryOf, rulesFor } from './evaluator.ts'
import { Rng } from './rng.ts'
import type { ShortDeckRules, VariantId } from './variants.ts'
import { BOARD_SIZE, VARIANTS, deckFor } from './variants.ts'

export interface RangeCombo {
  cards: readonly Card[]
  weight: number
}

export interface PlayerInput {
  /** Known hole cards, from none up to the variant's hole card count. */
  cards?: readonly Card[]
  /** Weighted range of complete holdings. When present, `cards` must be empty. */
  range?: readonly RangeCombo[]
}

export type Method = 'auto' | 'exact' | 'montecarlo'

export interface EquityRequest {
  variant: VariantId
  shortDeckRules?: ShortDeckRules
  players: readonly PlayerInput[]
  board?: readonly Card[]
  dead?: readonly Card[]
  method?: Method
  /** Largest number of hand evaluations exact mode may spend before auto falls back to Monte Carlo. */
  exactEvalLimit?: number
  /** Monte Carlo stops once every player's equity standard error is at or below this. */
  targetStdErr?: number
  maxTrials?: number
  timeLimitMs?: number
  seed?: number
}

export interface PlayerResult {
  /** Probability of winning the whole pot. */
  win: number
  /** Probability of tying for the best hand. */
  tie: number
  /** Expected share of the pot, win plus split shares. */
  equity: number
  /** Standard error of `equity` (0 for exact results). */
  stdErr: number
  /** Probability of finishing with each HandCategory (index = category id). */
  categories: number[]
}

/** Equity of every player while a range player holds one particular combo. */
export interface ComboBreakdown {
  cards: readonly Card[]
  /** Probability that the range player holds this combo, given everything else. */
  probability: number
  /** Equity of each player in deals where this combo is held. */
  equity: number[]
}

export interface RangeBreakdown {
  player: number
  combos: ComboBreakdown[]
}

/**
 * Additive accumulators. Two runs over disjoint samples (Monte Carlo shards with different seeds)
 * merge by summing every field, and `summarize` turns any raw total into a result.
 */
export interface RawTotals {
  playerCount: number
  totalWeight: number
  samples: number
  win: number[]
  tie: number[]
  equity: number[]
  equitySq: number[]
  /** playerCount * CATEGORY_COUNT */
  categories: number[]
  /** One entry per range player: per combo weight, and per combo x player equity sums. */
  combos: { player: number; weight: number[]; equity: number[] }[]
}

export interface EquityResult {
  method: 'exact' | 'montecarlo'
  players: PlayerResult[]
  ranges: RangeBreakdown[]
  raw: RawTotals
  /** Exact: number of distinct deals enumerated. Monte Carlo: accepted trials. */
  samples: number
  /** Exact mode: fraction of the enumeration completed. Monte Carlo: 1 when stopping criteria are met. */
  progress: number
  done: boolean
  elapsedMs: number
  /** Planned exact work in hand evaluations, when known. */
  exactEvals: number
}

export class EquityInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EquityInputError'
  }
}

export const DEFAULT_EXACT_EVAL_LIMIT = 40_000_000
export const DEFAULT_TARGET_STDERR = 0.0002
export const DEFAULT_MAX_TRIALS = 200_000_000
export const DEFAULT_TIME_LIMIT_MS = 12_000

// ---------------------------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------------------------

export interface Prepared {
  variant: VariantId
  rules: Rules
  holeCount: number
  mustUseTwo: boolean
  playerCount: number
  board: Card[]
  /** Known cards per player (players with ranges have none). */
  known: Card[][]
  /** Filtered ranges; undefined for players without a range. */
  ranges: (RangeCombo[] | undefined)[]
  /** Cards still in the deck before any range or random dealing. */
  deck: Card[]
  boardNeed: number
  /** How many random cards each player still needs. */
  randomNeed: number[]
  evalsPerPlayer: number
}

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return Math.round(r)
}

export function prepare(req: EquityRequest): Prepared {
  const info = VARIANTS[req.variant]
  if (!info) throw new EquityInputError(`Unknown variant "${String(req.variant)}"`)
  const rules = rulesFor(req.variant, req.shortDeckRules)
  const board = [...(req.board ?? [])]
  const dead = [...(req.dead ?? [])]
  const players = req.players
  if (players.length < 1) throw new EquityInputError('Add at least one player')
  if (players.length > info.maxPlayers) throw new EquityInputError(`${info.shortName} supports at most ${info.maxPlayers} players`)
  if (board.length > BOARD_SIZE) throw new EquityInputError('The board holds at most five cards')

  const owner = new Map<Card, string>()
  const claim = (card: Card, who: string) => {
    if (!Number.isInteger(card) || card < 0 || card > 51) throw new EquityInputError(`Invalid card id ${card}`)
    if (rankOf(card) < info.minRank) throw new EquityInputError(`${formatCard(card)} is not in the ${info.shortName} deck`)
    const prev = owner.get(card)
    if (prev) throw new EquityInputError(`${formatCard(card)} is used twice (${prev} and ${who})`)
    owner.set(card, who)
  }
  board.forEach((c) => claim(c, 'board'))
  dead.forEach((c) => claim(c, 'dead cards'))

  const known: Card[][] = []
  const ranges: (RangeCombo[] | undefined)[] = []
  players.forEach((p, i) => {
    const cards = [...(p.cards ?? [])]
    if (cards.length > info.holeCount) {
      throw new EquityInputError(`Player ${i + 1} has ${cards.length} cards; ${info.shortName} deals ${info.holeCount}`)
    }
    cards.forEach((c) => claim(c, `player ${i + 1}`))
    known.push(cards)
    if (p.range && cards.length) throw new EquityInputError(`Player ${i + 1} cannot have both cards and a range`)
    ranges.push(undefined)
  })

  players.forEach((p, i) => {
    if (!p.range) return
    const filtered: RangeCombo[] = []
    for (const combo of p.range) {
      if (combo.cards.length !== info.holeCount) {
        throw new EquityInputError(`Player ${i + 1}'s range contains a holding of ${combo.cards.length} cards`)
      }
      if (!(combo.weight > 0)) continue
      const clash = combo.cards.some((c, j) => owner.has(c) || rankOf(c) < info.minRank || combo.cards.indexOf(c) !== j)
      if (!clash) filtered.push({ cards: combo.cards, weight: Math.min(combo.weight, 1) })
    }
    if (!filtered.length) {
      throw new EquityInputError(
        p.range.length ? `Player ${i + 1}'s range is empty once known cards are removed` : `Player ${i + 1}'s range is empty`,
      )
    }
    ranges[i] = filtered
  })

  const deck = deckFor(req.variant).filter((c) => !owner.has(c))
  const boardNeed = BOARD_SIZE - board.length
  const randomNeed = players.map((p, i) => (p.range ? 0 : info.holeCount - known[i].length))
  const rangeCards = ranges.filter(Boolean).length * info.holeCount
  const needed = boardNeed + randomNeed.reduce((a, b) => a + b, 0) + rangeCards
  if (needed > deck.length) {
    throw new EquityInputError(`Not enough cards: this deal needs ${needed} more but only ${deck.length} remain`)
  }

  const evalsPerPlayer = info.mustUseTwo ? choose(info.holeCount, 2) * choose(BOARD_SIZE, 3) : 1
  return {
    variant: req.variant,
    rules,
    holeCount: info.holeCount,
    mustUseTwo: info.mustUseTwo,
    playerCount: players.length,
    board,
    known,
    ranges,
    deck,
    boardNeed,
    randomNeed,
    evalsPerPlayer,
  }
}

// ---------------------------------------------------------------------------------------------
// Joint range assignments
// ---------------------------------------------------------------------------------------------

interface JointList {
  /** assignments[i * rangePlayers.length] = combo index for each range player */
  combos: Int32Array
  weights: Float64Array
  count: number
  totalWeight: number
}

/**
 * Enumerates conflict-free joint range assignments, or returns undefined if there would be more than
 * `cap` of them (checked against the raw product first so huge ranges bail out immediately).
 */
function enumerateJoint(prep: Prepared, rangePlayers: number[], cap: number): JointList | undefined {
  const k = rangePlayers.length
  if (k === 0) return { combos: new Int32Array(0), weights: Float64Array.of(1), count: 1, totalWeight: 1 }
  let product = 1
  for (const p of rangePlayers) product *= prep.ranges[p]!.length
  if (product > cap * 8) return undefined

  const used = new Uint8Array(52)
  const choice = new Int32Array(k)
  let combos = new Int32Array(Math.min(product, cap) * k)
  const weights: number[] = []
  let count = 0
  let totalWeight = 0
  let overflow = false

  const rec = (depth: number, weight: number) => {
    if (overflow) return
    if (depth === k) {
      if (count >= cap) {
        overflow = true
        return
      }
      if ((count + 1) * k > combos.length) {
        const grown = new Int32Array(Math.min(cap, count * 2 + 16) * k)
        grown.set(combos)
        combos = grown
      }
      combos.set(choice, count * k)
      weights.push(weight)
      totalWeight += weight
      count++
      return
    }
    const range = prep.ranges[rangePlayers[depth]]!
    for (let i = 0; i < range.length; i++) {
      const cards = range[i].cards
      let ok = true
      for (let j = 0; j < cards.length; j++) if (used[cards[j]]) ok = false
      if (!ok) continue
      for (let j = 0; j < cards.length; j++) used[cards[j]] = 1
      choice[depth] = i
      rec(depth + 1, weight * range[i].weight)
      for (let j = 0; j < cards.length; j++) used[cards[j]] = 0
    }
  }
  rec(0, 1)
  if (overflow) return undefined
  return { combos, weights: Float64Array.from(weights), count, totalWeight }
}

// ---------------------------------------------------------------------------------------------
// Showdown kernel
// ---------------------------------------------------------------------------------------------

const PAIRS_OF: Record<number, [number, number][]> = {}
function pairIndices(n: number): [number, number][] {
  if (!PAIRS_OF[n]) {
    const out: [number, number][] = []
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push([a, b])
    PAIRS_OF[n] = out
  }
  return PAIRS_OF[n]
}
const BOARD_TRIPLES: [number, number, number][] = []
for (let x = 0; x < 5; x++) for (let y = x + 1; y < 5; y++) for (let z = y + 1; z < 5; z++) BOARD_TRIPLES.push([x, y, z])

/** Mutable deal state plus accumulators shared by exact and Monte Carlo drivers. */
class Table {
  readonly n: number
  readonly hole: Int32Array
  /** Hold'em: per player suit masks [c, d, h, s]. Omaha: per player, per hole pair, suit masks. */
  readonly holeMasks: Int32Array
  readonly boardCards = new Int32Array(5)
  readonly values: Int32Array
  readonly win: Float64Array
  readonly tie: Float64Array
  readonly equity: Float64Array
  readonly equitySq: Float64Array
  readonly categories: Float64Array
  totalWeight = 0
  samples = 0
  /** Combo index currently held by each range player, -1 for other players. */
  readonly comboIndex: Int32Array
  readonly rangePlayers: number[]
  readonly comboWeight: Float64Array[]
  readonly comboEquity: Float64Array[]

  private readonly pairs: [number, number][]
  private readonly tripleMasks = new Int32Array(40)

  readonly prep: Prepared
  readonly trackSquares: boolean

  constructor(prep: Prepared, trackSquares: boolean) {
    this.prep = prep
    this.trackSquares = trackSquares
    this.n = prep.playerCount
    this.hole = new Int32Array(this.n * prep.holeCount)
    this.pairs = pairIndices(prep.holeCount)
    this.holeMasks = new Int32Array(this.n * (prep.mustUseTwo ? this.pairs.length * 4 : 4))
    this.values = new Int32Array(this.n)
    this.win = new Float64Array(this.n)
    this.tie = new Float64Array(this.n)
    this.equity = new Float64Array(this.n)
    this.equitySq = new Float64Array(this.n)
    this.categories = new Float64Array(this.n * CATEGORY_COUNT)
    this.comboIndex = new Int32Array(this.n).fill(-1)
    this.rangePlayers = prep.ranges.flatMap((r, i) => (r ? [i] : []))
    this.comboWeight = this.rangePlayers.map((p) => new Float64Array(prep.ranges[p]!.length))
    this.comboEquity = this.rangePlayers.map((p) => new Float64Array(prep.ranges[p]!.length * this.n))
  }

  /** Recomputes cached masks for player p after its hole cards change. */
  refreshPlayer(p: number): void {
    const hc = this.prep.holeCount
    const base = p * hc
    if (!this.prep.mustUseTwo) {
      let c = 0
      let d = 0
      let h = 0
      let s = 0
      for (let i = 0; i < hc; i++) {
        const card = this.hole[base + i]
        const bit = 1 << (card >> 2)
        switch (card & 3) {
          case 0: c |= bit; break
          case 1: d |= bit; break
          case 2: h |= bit; break
          default: s |= bit
        }
      }
      const o = p * 4
      this.holeMasks[o] = c
      this.holeMasks[o + 1] = d
      this.holeMasks[o + 2] = h
      this.holeMasks[o + 3] = s
      return
    }
    const pairs = this.pairs
    const o = p * pairs.length * 4
    for (let i = 0; i < pairs.length; i++) {
      const j = o + i * 4
      this.holeMasks[j] = this.holeMasks[j + 1] = this.holeMasks[j + 2] = this.holeMasks[j + 3] = 0
      for (const idx of pairs[i]) {
        const card = this.hole[base + idx]
        this.holeMasks[j + (card & 3)] |= 1 << (card >> 2)
      }
    }
  }

  /** Scores the deal currently in `hole` and `boardCards` and accumulates it with `weight`. */
  showdown(weight: number): void {
    const n = this.n
    const values = this.values
    const hm = this.holeMasks
    const evalMasks = this.prep.rules.evalMasks
    const bc = this.boardCards

    if (!this.prep.mustUseTwo) {
      let c = 0
      let d = 0
      let h = 0
      let s = 0
      for (let i = 0; i < 5; i++) {
        const card = bc[i]
        const bit = 1 << (card >> 2)
        switch (card & 3) {
          case 0: c |= bit; break
          case 1: d |= bit; break
          case 2: h |= bit; break
          default: s |= bit
        }
      }
      for (let p = 0, o = 0; p < n; p++, o += 4) {
        values[p] = evalMasks(c | hm[o], d | hm[o + 1], h | hm[o + 2], s | hm[o + 3], 7)
      }
    } else {
      const tm = this.tripleMasks
      for (let t = 0; t < 10; t++) {
        const tri = BOARD_TRIPLES[t]
        const j = t * 4
        tm[j] = tm[j + 1] = tm[j + 2] = tm[j + 3] = 0
        for (let q = 0; q < 3; q++) {
          const card = bc[tri[q]]
          tm[j + (card & 3)] |= 1 << (card >> 2)
        }
      }
      const pairCount = this.pairs.length
      for (let p = 0; p < n; p++) {
        let best = 0
        const po = p * pairCount * 4
        for (let i = 0; i < pairCount; i++) {
          const j = po + i * 4
          const c = hm[j]
          const d = hm[j + 1]
          const h = hm[j + 2]
          const s = hm[j + 3]
          for (let t = 0; t < 40; t += 4) {
            const v = evalMasks(c | tm[t], d | tm[t + 1], h | tm[t + 2], s | tm[t + 3], 5)
            if (v > best) best = v
          }
        }
        values[p] = best
      }
    }

    let best = 0
    let winners = 0
    for (let p = 0; p < n; p++) {
      const v = values[p]
      if (v > best) {
        best = v
        winners = 1
      } else if (v === best) winners++
    }
    const cats = this.categories
    if (winners === 1) {
      for (let p = 0; p < n; p++) {
        const v = values[p]
        cats[p * CATEGORY_COUNT + ((v >> 20) & 15)] += weight
        if (v === best) {
          this.win[p] += weight
          this.equity[p] += weight
          if (this.trackSquares) this.equitySq[p] += weight
        }
      }
    } else {
      const share = 1 / winners
      for (let p = 0; p < n; p++) {
        const v = values[p]
        cats[p * CATEGORY_COUNT + ((v >> 20) & 15)] += weight
        if (v === best) {
          this.tie[p] += weight
          this.equity[p] += weight * share
          if (this.trackSquares) this.equitySq[p] += weight * share * share
        }
      }
    }
    const rp = this.rangePlayers
    for (let r = 0; r < rp.length; r++) {
      const idx = this.comboIndex[rp[r]]
      this.comboWeight[r][idx] += weight
      const eqRow = this.comboEquity[r]
      const o = idx * n
      if (winners === 1) {
        for (let p = 0; p < n; p++) if (values[p] === best) eqRow[o + p] += weight
      } else {
        const share = weight / winners
        for (let p = 0; p < n; p++) if (values[p] === best) eqRow[o + p] += share
      }
    }
    this.totalWeight += weight
    this.samples++
  }

  raw(): RawTotals {
    return {
      playerCount: this.n,
      totalWeight: this.totalWeight,
      samples: this.samples,
      win: Array.from(this.win),
      tie: Array.from(this.tie),
      equity: Array.from(this.equity),
      equitySq: Array.from(this.equitySq),
      categories: Array.from(this.categories),
      combos: this.rangePlayers.map((player, r) => ({
        player,
        weight: Array.from(this.comboWeight[r]),
        equity: Array.from(this.comboEquity[r]),
      })),
    }
  }

  result(method: 'exact' | 'montecarlo', start: number, progress: number, done: boolean, exactEvals: number): EquityResult {
    return summarize(this.prep, this.raw(), method, { progress, done, elapsedMs: now() - start, exactEvals })
  }
}

export function emptyRaw(prep: Prepared): RawTotals {
  const n = prep.playerCount
  return {
    playerCount: n,
    totalWeight: 0,
    samples: 0,
    win: new Array(n).fill(0),
    tie: new Array(n).fill(0),
    equity: new Array(n).fill(0),
    equitySq: new Array(n).fill(0),
    categories: new Array(n * CATEGORY_COUNT).fill(0),
    combos: prep.ranges.flatMap((r, player) =>
      r ? [{ player, weight: new Array(r.length).fill(0), equity: new Array(r.length * n).fill(0) }] : [],
    ),
  }
}

/** Adds `b` into `a` (same prepared spot). */
export function mergeRaw(a: RawTotals, b: RawTotals): RawTotals {
  const add = (x: number[], y: number[]) => x.map((v, i) => v + y[i])
  return {
    playerCount: a.playerCount,
    totalWeight: a.totalWeight + b.totalWeight,
    samples: a.samples + b.samples,
    win: add(a.win, b.win),
    tie: add(a.tie, b.tie),
    equity: add(a.equity, b.equity),
    equitySq: add(a.equitySq, b.equitySq),
    categories: add(a.categories, b.categories),
    combos: a.combos.map((c, i) => ({
      player: c.player,
      weight: add(c.weight, b.combos[i].weight),
      equity: add(c.equity, b.combos[i].equity),
    })),
  }
}

/** Largest per-player equity standard error of a Monte Carlo total. */
export function worstStdErr(raw: RawTotals): number {
  if (raw.samples < 2 || raw.totalWeight <= 0) return Infinity
  let worst = 0
  for (let p = 0; p < raw.playerCount; p++) {
    const eq = raw.equity[p] / raw.totalWeight
    const se = Math.sqrt(Math.max(0, raw.equitySq[p] / raw.totalWeight - eq * eq) / (raw.samples - 1))
    if (se > worst) worst = se
  }
  return worst
}

export function summarize(
  prep: Prepared,
  raw: RawTotals,
  method: 'exact' | 'montecarlo',
  meta: { progress: number; done: boolean; elapsedMs: number; exactEvals: number },
): EquityResult {
  const W = raw.totalWeight || 1
  const n = raw.playerCount
  const players: PlayerResult[] = []
  for (let p = 0; p < n; p++) {
    const eq = raw.equity[p] / W
    let stdErr = 0
    if (method === 'montecarlo' && raw.samples > 1) {
      stdErr = Math.sqrt(Math.max(0, raw.equitySq[p] / W - eq * eq) / (raw.samples - 1))
    }
    const categories: number[] = []
    for (let k = 0; k < CATEGORY_COUNT; k++) categories.push(raw.categories[p * CATEGORY_COUNT + k] / W)
    players.push({ win: raw.win[p] / W, tie: raw.tie[p] / W, equity: eq, stdErr, categories })
  }
  const ranges: RangeBreakdown[] = raw.combos.map((c) => ({
    player: c.player,
    combos: prep.ranges[c.player]!.map((combo, i) => {
      const w = c.weight[i]
      const equity: number[] = []
      for (let p = 0; p < n; p++) equity.push(w > 0 ? c.equity[i * n + p] / w : 0)
      return { cards: combo.cards, probability: w / W, equity }
    }),
  }))
  return { method, players, ranges, raw, samples: raw.samples, ...meta }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

export interface Plan {
  method: 'exact' | 'montecarlo'
  /** Exact hand evaluations needed, or Infinity when too large to count. */
  exactEvals: number
  joint?: JointList
  rangePlayers: number[]
}

const JOINT_ENUM_CAP = 400_000

export interface PlanOptions extends Pick<EquityRequest, 'method' | 'exactEvalLimit'> {
  /** Most joint range assignments to materialise (Monte Carlo above this uses rejection sampling). */
  jointCap?: number
}

export function plan(prep: Prepared, req: PlanOptions = {}): Plan {
  const rangePlayers = prep.ranges.flatMap((r, i) => (r ? [i] : []))
  const joint = enumerateJoint(prep, rangePlayers, req.jointCap ?? JOINT_ENUM_CAP)
  if (joint && joint.count === 0) throw new EquityInputError('These ranges cannot all be dealt at once: every combination shares a card')

  let completions = 1
  let left = prep.deck.length - rangePlayers.length * prep.holeCount
  for (const need of prep.randomNeed) {
    completions *= choose(left, need)
    left -= need
  }
  completions *= choose(left, prep.boardNeed)
  const exactEvals = joint ? joint.count * completions * prep.playerCount * prep.evalsPerPlayer : Infinity

  const limit = req.exactEvalLimit ?? DEFAULT_EXACT_EVAL_LIMIT
  let method: 'exact' | 'montecarlo'
  if (req.method === 'exact') {
    if (!joint) throw new EquityInputError('Too many range combinations to enumerate exactly')
    method = 'exact'
  } else if (req.method === 'montecarlo') method = 'montecarlo'
  else method = exactEvals <= limit ? 'exact' : 'montecarlo'
  return { method, exactEvals, joint, rangePlayers }
}

// ---------------------------------------------------------------------------------------------
// Exact enumeration
// ---------------------------------------------------------------------------------------------

export type ProgressFn = (snapshot: EquityResult) => void

function loadKnownAndRanges(table: Table, prep: Prepared, rangePlayers: number[], joint: JointList, j: number, used: Uint8Array) {
  const hc = prep.holeCount
  for (let r = 0; r < rangePlayers.length; r++) {
    const p = rangePlayers[r]
    const idx = joint.combos[j * rangePlayers.length + r]
    table.comboIndex[p] = idx
    const cards = prep.ranges[p]![idx].cards
    for (let i = 0; i < hc; i++) {
      table.hole[p * hc + i] = cards[i]
      used[cards[i]] = 1
    }
    table.refreshPlayer(p)
  }
}

export function runExact(prep: Prepared, planned: Plan, onProgress?: ProgressFn, progressEveryMs = 120): EquityResult {
  const start = now()
  const joint = planned.joint
  if (!joint) throw new EquityInputError('Too many range combinations to enumerate exactly')
  const table = new Table(prep, false)
  const hc = prep.holeCount
  const n = prep.playerCount
  const deck = prep.deck
  const used = new Uint8Array(52)
  const rangePlayers = planned.rangePlayers

  // Known cards occupy the first slots of each non-range player.
  for (let p = 0; p < n; p++) prep.known[p].forEach((c, i) => (table.hole[p * hc + i] = c))
  for (let i = 0; i < prep.board.length; i++) table.boardCards[i] = prep.board[i]

  // Random slots, in dealing order: [player, slot index] for each missing hole card.
  const slots: [number, number][] = []
  for (let p = 0; p < n; p++) for (let i = prep.known[p].length; i < hc && !prep.ranges[p]; i++) slots.push([p, i])
  const boardStart = prep.board.length
  const boardNeed = prep.boardNeed

  let lastReport = start
  let checkCounter = 0
  let unitsDone = 0
  const totalUnits = joint.count
  const report = (force: boolean) => {
    if (!onProgress) return
    const t = now()
    if (!force && t - lastReport < progressEveryMs) return
    lastReport = t
    onProgress(table.result('exact', start, unitsDone / totalUnits, false, planned.exactEvals))
  }

  let weight = 1
  const dealBoard = (from: number, depth: number) => {
    if (depth === boardNeed) {
      table.showdown(weight)
      if (++checkCounter === 16384) {
        checkCounter = 0
        report(false)
      }
      return
    }
    for (let i = from; i <= deck.length - (boardNeed - depth); i++) {
      const card = deck[i]
      if (used[card]) continue
      used[card] = 1
      table.boardCards[boardStart + depth] = card
      dealBoard(i + 1, depth + 1)
      used[card] = 0
    }
  }

  // Players' random cards: combinations within a player (increasing deck index), free across players.
  const dealSlots = (s: number, from: number) => {
    if (s === slots.length) {
      dealBoard(0, 0)
      return
    }
    const [p, i] = slots[s]
    const samePlayerAsPrev = s > 0 && slots[s - 1][0] === p
    const remainingForPlayer = hc - i
    for (let d = samePlayerAsPrev ? from : 0; d <= deck.length - remainingForPlayer; d++) {
      const card = deck[d]
      if (used[card]) continue
      used[card] = 1
      table.hole[p * hc + i] = card
      if (i === hc - 1) table.refreshPlayer(p)
      dealSlots(s + 1, d + 1)
      used[card] = 0
    }
  }

  for (let p = 0; p < n; p++) if (!prep.ranges[p] && prep.known[p].length === hc) table.refreshPlayer(p)

  for (let j = 0; j < joint.count; j++) {
    loadKnownAndRanges(table, prep, rangePlayers, joint, j, used)
    weight = joint.weights[j]
    dealSlots(0, 0)
    for (const p of rangePlayers) for (let i = 0; i < hc; i++) used[table.hole[p * hc + i]] = 0
    unitsDone = j + 1
    report(false)
  }
  return table.result('exact', start, 1, true, planned.exactEvals)
}

// ---------------------------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------------------------

export interface MonteCarloOptions {
  targetStdErr?: number
  maxTrials?: number
  timeLimitMs?: number
  seed?: number
  onProgress?: ProgressFn
  progressEveryMs?: number
}

class WeightedSampler {
  private readonly cumulative: Float64Array
  constructor(weights: ArrayLike<number>) {
    this.cumulative = new Float64Array(weights.length)
    let sum = 0
    for (let i = 0; i < weights.length; i++) {
      sum += weights[i]
      this.cumulative[i] = sum
    }
  }
  sample(rng: Rng): number {
    const cum = this.cumulative
    const x = rng.nextFloat() * cum[cum.length - 1]
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] > x) hi = mid
      else lo = mid + 1
    }
    return lo
  }
}

const MAX_CONSECUTIVE_REJECTIONS = 2_000_000

export function runMonteCarlo(prep: Prepared, planned: Plan, opts: MonteCarloOptions = {}): EquityResult {
  const start = now()
  const rng = new Rng(opts.seed)
  const target = opts.targetStdErr ?? DEFAULT_TARGET_STDERR
  const maxTrials = opts.maxTrials ?? DEFAULT_MAX_TRIALS
  const timeLimit = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS
  const progressEvery = opts.progressEveryMs ?? 120
  const table = new Table(prep, true)
  const hc = prep.holeCount
  const n = prep.playerCount
  const rangePlayers = planned.rangePlayers
  const k = rangePlayers.length

  // Deck as a permutation with a position index so specific cards can be moved out of play in O(1).
  const deck = Int32Array.from(prep.deck)
  const pos = new Int32Array(52).fill(-1)
  deck.forEach((c, i) => (pos[c] = i))
  const swap = (i: number, j: number) => {
    const a = deck[i]
    const b = deck[j]
    deck[i] = b
    deck[j] = a
    pos[b] = i
    pos[a] = j
  }

  for (let p = 0; p < n; p++) prep.known[p].forEach((c, i) => (table.hole[p * hc + i] = c))
  for (let i = 0; i < prep.board.length; i++) table.boardCards[i] = prep.board[i]
  for (let p = 0; p < n; p++) if (!prep.ranges[p] && prep.known[p].length === hc) table.refreshPlayer(p)

  const jointSampler = planned.joint && k > 0 ? new WeightedSampler(planned.joint.weights) : undefined
  const perPlayerSamplers = rangePlayers.map((p) => new WeightedSampler(prep.ranges[p]!.map((c) => c.weight)))
  const stamp = new Int32Array(52)
  let epoch = 0
  const chosen = new Int32Array(k)

  const randomPlayers: number[] = []
  for (let p = 0; p < n; p++) if (prep.randomNeed[p] > 0) randomPlayers.push(p)
  const boardStart = prep.board.length
  const boardNeed = prep.boardNeed

  let lastReport = start
  let done = false
  let progress = 0

  while (!done) {
    const batch = 4096
    for (let b = 0; b < batch; b++) {
      // 1. Range players.
      if (k > 0) {
        if (jointSampler) {
          const j = jointSampler.sample(rng)
          for (let r = 0; r < k; r++) chosen[r] = planned.joint!.combos[j * k + r]
        } else {
          let rejections = 0
          for (;;) {
            epoch++
            let ok = true
            for (let r = 0; r < k && ok; r++) {
              const idx = perPlayerSamplers[r].sample(rng)
              chosen[r] = idx
              const cards = prep.ranges[rangePlayers[r]]![idx].cards
              for (let i = 0; i < cards.length; i++) {
                if (stamp[cards[i]] === epoch) ok = false
                stamp[cards[i]] = epoch
              }
            }
            if (ok) break
            if (++rejections > MAX_CONSECUTIVE_REJECTIONS) {
              throw new EquityInputError('These ranges almost never fit together; narrow them or use fewer overlapping ranges')
            }
          }
        }
      }
      // 2. Move range cards to the front of the deck; everything after `top` is live.
      let top = 0
      for (let r = 0; r < k; r++) {
        const p = rangePlayers[r]
        table.comboIndex[p] = chosen[r]
        const cards = prep.ranges[p]![chosen[r]].cards
        for (let i = 0; i < hc; i++) {
          const card = cards[i]
          table.hole[p * hc + i] = card
          swap(pos[card], top++)
        }
        table.refreshPlayer(p)
      }
      // 3. Partial Fisher-Yates for random hole cards and the board.
      const live = deck.length
      for (let q = 0; q < randomPlayers.length; q++) {
        const p = randomPlayers[q]
        for (let i = prep.known[p].length; i < hc; i++) {
          swap(top + rng.nextInt(live - top), top)
          table.hole[p * hc + i] = deck[top++]
        }
        table.refreshPlayer(p)
      }
      for (let i = 0; i < boardNeed; i++) {
        swap(top + rng.nextInt(live - top), top)
        table.boardCards[boardStart + i] = deck[top++]
      }
      table.showdown(1)
    }

    const t = now()
    let worstErr = 0
    if (table.samples > 1) {
      const W = table.totalWeight
      for (let p = 0; p < n; p++) {
        const eq = table.equity[p] / W
        const se = Math.sqrt(Math.max(0, table.equitySq[p] / W - eq * eq) / (table.samples - 1))
        if (se > worstErr) worstErr = se
      }
    }
    // Require a floor of trials so a lucky early streak cannot fake convergence.
    const converged = table.samples >= 50_000 && worstErr <= target
    progress = Math.min(1, Math.max(table.samples / maxTrials, (t - start) / timeLimit, converged ? 1 : target / Math.max(worstErr, 1e-12)))
    if (converged || table.samples >= maxTrials || t - start >= timeLimit) done = true
    if (!done && opts.onProgress && t - lastReport >= progressEvery) {
      lastReport = t
      opts.onProgress(table.result('montecarlo', start, progress, false, planned.exactEvals))
    }
  }
  return table.result('montecarlo', start, 1, true, planned.exactEvals)
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export function calculateEquity(req: EquityRequest, onProgress?: ProgressFn): EquityResult {
  const prep = prepare(req)
  const planned = plan(prep, req)
  if (planned.method === 'exact') return runExact(prep, planned, onProgress)
  return runMonteCarlo(prep, planned, {
    targetStdErr: req.targetStdErr,
    maxTrials: req.maxTrials,
    timeLimitMs: req.timeLimitMs,
    seed: req.seed,
    onProgress,
  })
}

export interface NextCardResult {
  card: Card
  /** Equity per player once this card lands, or undefined if the card cannot come (all deals blocked). */
  equity: number[] | undefined
  method: 'exact' | 'montecarlo'
}

/**
 * For a flop or turn, the equity of every player after each possible next card.
 * Cards already used anywhere are skipped. Each sub-problem is solved exactly when cheap,
 * otherwise by a bounded Monte Carlo run.
 */
export function nextCardAnalysis(
  req: EquityRequest,
  opts: { exactEvalLimit?: number; trialsPerCard?: number; seed?: number; onCard?: (r: NextCardResult, index: number, total: number) => void } = {},
): NextCardResult[] {
  const prep = prepare(req)
  if (prep.board.length !== 3 && prep.board.length !== 4) return []
  const out: NextCardResult[] = []
  const rng = new Rng(opts.seed)
  const cards = prep.deck
  cards.forEach((card, index) => {
    let result: NextCardResult
    try {
      const sub: EquityRequest = { ...req, board: [...prep.board, card], method: 'auto' }
      const subPrep = prepare(sub)
      const subPlan = plan(subPrep, { exactEvalLimit: opts.exactEvalLimit ?? 2_000_000 })
      const r =
        subPlan.method === 'exact'
          ? runExact(subPrep, subPlan)
          : runMonteCarlo(subPrep, subPlan, {
              maxTrials: opts.trialsPerCard ?? 20_000,
              targetStdErr: 0,
              timeLimitMs: 2_000,
              seed: rng.nextU32(),
            })
      result = { card, equity: r.players.map((p) => p.equity), method: r.method }
    } catch (err) {
      if (!(err instanceof EquityInputError)) throw err
      result = { card, equity: undefined, method: 'exact' }
    }
    out.push(result)
    opts.onCard?.(result, index, cards.length)
  })
  return out
}

/** The best made hand value for a player's known cards on the current board, if one exists yet. */
export function currentHandValue(
  variant: VariantId,
  hole: readonly Card[],
  board: readonly Card[],
  shortDeckRules?: ShortDeckRules,
): number | undefined {
  const info = VARIANTS[variant]
  const rules = rulesFor(variant, shortDeckRules)
  if (hole.length !== info.holeCount) return undefined
  if (new Set([...hole, ...board]).size !== hole.length + board.length) return undefined
  if (info.mustUseTwo) {
    if (board.length < 3) return undefined
    let best = 0
    for (const [a, b] of pairIndices(hole.length))
      for (let x = 0; x < board.length; x++)
        for (let y = x + 1; y < board.length; y++)
          for (let z = y + 1; z < board.length; z++) {
            const m = [0, 0, 0, 0]
            for (const c of [hole[a], hole[b], board[x], board[y], board[z]]) m[suitOf(c)] |= 1 << rankOf(c)
            const v = rules.evalMasks(m[0], m[1], m[2], m[3], 5)
            if (v > best) best = v
          }
    return best
  }
  const all = [...hole, ...board]
  if (all.length < 5) return undefined
  const m = [0, 0, 0, 0]
  for (const c of all) m[suitOf(c)] |= 1 << rankOf(c)
  return rules.evalMasks(m[0], m[1], m[2], m[3], all.length)
}

export { categoryOf }
