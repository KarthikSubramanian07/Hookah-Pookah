import { describe, expect, it } from 'vitest'
import { parseCards } from '../src/engine/cards.ts'
import {
  EquityInputError,
  type EquityRequest,
  type PlayerInput,
  calculateEquity,
  currentHandValue,
  emptyRaw,
  mergeRaw,
  nextCardAnalysis,
  plan,
  prepare,
  runExact,
  runMonteCarlo,
  summarize,
  worstStdErr,
} from '../src/engine/equity.ts'
import { describeValue } from '../src/engine/evaluator.ts'
import { comboFromKey, parseRange } from '../src/engine/ranges.ts'
import { Rng } from '../src/engine/rng.ts'
import type { VariantId } from '../src/engine/variants.ts'
import { REF_SHORT_CLASSIC, REF_SHORT_TRITON, REF_STANDARD, refEquity } from './reference.ts'

const C = (text: string): PlayerInput => ({ cards: parseCards(text) })
const R = (text: string, variant: VariantId = 'holdem'): PlayerInput => ({
  range: [...parseRange(text, variant).combos].map(([key, weight]) => ({ cards: comboFromKey(key), weight })),
})
const pct = (x: number) => Math.round(x * 1e6) / 1e4

/**
 * Exact reference equities. Hold'em rows were cross-checked with OMPEval's exhaustive enumerator and a
 * separate C brute force; PLO and short deck rows with the C brute force; short deck Triton rows with
 * the naive TypeScript reference in tests/reference.ts.
 */
describe('exact equities match independent enumerators', () => {
  const cases: [string, VariantId, PlayerInput[], number[], Partial<EquityRequest>?][] = [
    ['AsAh vs KsKh', 'holdem', [C('AsAh'), C('KsKh')], [82.6366, 17.3634]],
    ['AsKs vs QhQd', 'holdem', [C('AsKs'), C('QhQd')], [46.2145, 53.7855]],
    ['AcAd vs 7h2s', 'holdem', [C('AcAd'), C('7h2s')], [87.4224, 12.5776]],
    ['AsKd vs 8c7c', 'holdem', [C('AsKd'), C('8c7c')], [58.1001, 41.8999]],
    ['AsKs vs 2c2d', 'holdem', [C('AsKs'), C('2c2d')], [50.0842, 49.9158]],
    ['AhAs vs KhKs vs QhQs', 'holdem', [C('AhAs'), C('KhKs'), C('QhQs')], [67.6703, 17.2317, 15.098]],
    ['JhJs vs TdTs vs AcKc', 'holdem', [C('JhJs'), C('TdTs'), C('AcKc')], [43.2149, 17.2787, 39.5064]],
    ['PLO4 AsAhKsKh vs JdTd9c8c', 'omaha4', [C('AsAhKsKh'), C('JdTd9c8c')], [61.4813, 38.5187], { exactEvalLimit: 2e8 }],
    ['PLO5 AsAhKsKhQd vs JcTc9d8d7h', 'omaha5', [C('AsAhKsKhQd'), C('JcTc9d8d7h')], [55.2265, 44.7735], { exactEvalLimit: 2e8 }],
    ['short deck classic AsAh vs KsKh', 'shortdeck', [C('AsAh'), C('KsKh')], [75.0243, 24.9757], { shortDeckRules: 'classic' }],
    ['short deck classic 3-way', 'shortdeck', [C('AsAh'), C('KsKh'), C('QsQh')], [56.3929, 22.8617, 20.7453], { shortDeckRules: 'classic' }],
    ['short deck triton AsAh vs KsKh', 'shortdeck', [C('AsAh'), C('KsKh')], [74.9618, 25.0382], { shortDeckRules: 'triton' }],
  ]
  for (const [name, variant, players, expected, extra] of cases) {
    it(name, () => {
      const r = calculateEquity({ variant, players, method: 'exact', ...extra })
      expect(r.method).toBe('exact')
      expect(r.done).toBe(true)
      r.players.forEach((p, i) => expect(pct(p.equity)).toBeCloseTo(expected[i], 3))
      expect(r.players.reduce((s, p) => s + p.equity, 0)).toBeCloseTo(1, 12)
    })
  }

  it('reports raw board counts for AsAh vs KsKh', () => {
    const r = calculateEquity({ variant: 'holdem', players: [C('AsAh'), C('KsKh')] })
    expect(r.samples).toBe(1712304)
    expect(Math.round(r.players[0].win * 1712304)).toBe(1410336)
    expect(Math.round(r.players[1].win * 1712304)).toBe(292660)
    expect(Math.round(r.players[0].tie * 1712304)).toBe(9308)
  })
})

describe('differential fuzz against the brute-force oracle', () => {
  const variants = [
    { id: 'holdem', low: 0, rules: REF_STANDARD, omaha: false, hc: 2, sd: undefined },
    { id: 'shortdeck', low: 4, rules: REF_SHORT_TRITON, omaha: false, hc: 2, sd: 'triton' },
    { id: 'shortdeck', low: 4, rules: REF_SHORT_CLASSIC, omaha: false, hc: 2, sd: 'classic' },
    { id: 'omaha4', low: 0, rules: REF_STANDARD, omaha: true, hc: 4, sd: undefined },
    { id: 'omaha5', low: 0, rules: REF_STANDARD, omaha: true, hc: 5, sd: undefined },
  ] as const

  it('agrees on 60 random late-street scenarios with ranges, weights, partial hands and dead cards', () => {
    const rng = new Rng(424242)
    let compared = 0
    for (let it = 0; it < 60; it++) {
      const v = variants[it % variants.length]
      const deck: number[] = []
      for (let c = v.low * 4; c < 52; c++) deck.push(c)
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1)
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      let top = 0
      const boardLen = 4 + rng.nextInt(2)
      const board = deck.slice(top, (top += boardLen))
      const dead = deck.slice(top, (top += rng.nextInt(3)))
      const n = 2 + rng.nextInt(v.omaha ? 2 : 3)
      const players: PlayerInput[] = []
      let partialUsed = false
      for (let p = 0; p < n; p++) {
        const kind = rng.nextInt(3)
        if (kind === 0 && !v.omaha) {
          const range: { cards: number[]; weight: number }[] = []
          for (let i = 0; i < 1 + rng.nextInt(5); i++) {
            const a = deck[top + rng.nextInt(10)]
            const b = deck[top + rng.nextInt(10)]
            if (a !== b && !range.some((r) => r.cards.includes(a) && r.cards.includes(b))) {
              range.push({ cards: [a, b], weight: [1, 0.5, 0.25][rng.nextInt(3)] })
            }
          }
          if (range.length) {
            players.push({ range })
            continue
          }
        }
        if (kind === 1 && !partialUsed && boardLen === 5) {
          partialUsed = true
          players.push({ cards: deck.slice(top, (top += v.hc - 1)) })
          continue
        }
        players.push({ cards: deck.slice(top, (top += v.hc)) })
      }
      const req: EquityRequest = { variant: v.id, shortDeckRules: v.sd, players, board, dead, method: 'exact' }
      let mine
      try {
        mine = calculateEquity(req)
      } catch (err) {
        expect(err).toBeInstanceOf(EquityInputError)
        continue
      }
      const ref = refEquity({ lowRank: v.low, rules: v.rules, omaha: v.omaha, holeCount: v.hc, board, dead, players: players as never })
      for (let p = 0; p < n; p++) {
        expect(mine.players[p].equity).toBeCloseTo(ref.equity[p], 10)
        expect(mine.players[p].win).toBeCloseTo(ref.win[p], 10)
        expect(mine.players[p].tie).toBeCloseTo(ref.tie[p], 10)
        mine.players[p].categories.forEach((x, k) => expect(x).toBeCloseTo(ref.categories[p][k], 10))
      }
      compared++
    }
    expect(compared).toBeGreaterThan(40)
  })
})

describe('Monte Carlo', () => {
  it('lands within 4 standard errors of the exact answer for every sampling path', () => {
    const cases: EquityRequest[] = [
      { variant: 'holdem', players: [C('AhKh'), C('QsQd')], board: parseCards('Jh7h2c') },
      { variant: 'holdem', players: [C('AhKh'), {}, {}], board: parseCards('Jh7h2cQd') },
      { variant: 'holdem', players: [R('AA,KK:0.5,AKs'), R('AA,KK,AKs:0.25'), R('QQ+,AK')], board: parseCards('Kh7h2c') },
      { variant: 'omaha4', players: [C('AhKhQsJs'), {}], board: parseCards('Th9h2c8d3s') },
    ]
    cases.forEach((req, i) => {
      const prep = prepare(req)
      const exact = runExact(prep, plan(prep, { method: 'exact' }))
      const mc = runMonteCarlo(prep, plan(prep, { method: 'montecarlo' }), { seed: 99 + i, maxTrials: 60_000, targetStdErr: 0 })
      expect(mc.method).toBe('montecarlo')
      mc.players.forEach((p, k) => {
        expect(p.stdErr).toBeGreaterThan(0)
        expect(Math.abs(p.equity - exact.players[k].equity)).toBeLessThan(4 * p.stdErr + 1e-9)
      })
    })
  })

  it('samples overlapping ranges without bias through rejection sampling', () => {
    const req: EquityRequest = { variant: 'holdem', players: [R('random'), R('random'), C('9s9d')], board: parseCards('Kh7h2c8d4s') }
    const prep = prepare(req)
    const exact = runExact(prep, plan(prep, { method: 'exact', jointCap: 1e8 }))
    const rejection = plan(prep, { method: 'montecarlo', jointCap: 10 })
    expect(rejection.joint).toBeUndefined()
    const mc = runMonteCarlo(prep, rejection, { seed: 5, maxTrials: 80_000, targetStdErr: 0 })
    mc.players.forEach((p, k) => expect(Math.abs(p.equity - exact.players[k].equity)).toBeLessThan(4 * p.stdErr))
  })

  it('is reproducible with a seed and stops at the target precision', () => {
    const req: EquityRequest = { variant: 'holdem', players: [C('AhKh'), {}], seed: 7, targetStdErr: 0.004, method: 'montecarlo' }
    const a = calculateEquity(req)
    const b = calculateEquity(req)
    expect(a.players[0].equity).toBe(b.players[0].equity)
    expect(a.samples).toBeGreaterThanOrEqual(50_000)
    expect(worstStdErr(a.raw)).toBeLessThanOrEqual(0.004)
  })

  it('merges shards into the same numbers as a single run over both', () => {
    const prep = prepare({ variant: 'holdem', players: [C('AhKh'), R('QQ+,AKs')], board: parseCards('Qh7h2c') })
    const p = plan(prep, { method: 'montecarlo' })
    const s1 = runMonteCarlo(prep, p, { seed: 1, maxTrials: 20_000, targetStdErr: 0 })
    const s2 = runMonteCarlo(prep, p, { seed: 2, maxTrials: 20_000, targetStdErr: 0 })
    const merged = mergeRaw(mergeRaw(emptyRaw(prep), s1.raw), s2.raw)
    const result = summarize(prep, merged, 'montecarlo', { progress: 1, done: true, elapsedMs: 0, exactEvals: 0 })
    expect(result.samples).toBe(s1.samples + s2.samples)
    const expected = (s1.raw.equity[0] + s2.raw.equity[0]) / (s1.raw.totalWeight + s2.raw.totalWeight)
    expect(result.players[0].equity).toBeCloseTo(expected, 12)
    expect(result.players[0].stdErr).toBeLessThan(s1.players[0].stdErr)
  })

  it('reports progress snapshots while running', () => {
    const snapshots: number[] = []
    calculateEquity(
      { variant: 'holdem', players: [C('AhKh'), {}, {}], method: 'montecarlo', maxTrials: 400_000, targetStdErr: 0, seed: 3 },
      (s) => snapshots.push(s.samples),
    )
    expect(snapshots.length).toBeGreaterThan(0)
  })
})

describe('range breakdown', () => {
  it('gives each villain combo its conditional equity and probability', () => {
    const board = parseCards('Qh7h2c')
    const r = calculateEquity({ variant: 'holdem', players: [C('AhKh'), R('QQ,AKs')], board })
    const breakdown = r.ranges[0]
    expect(breakdown.player).toBe(1)
    const total = breakdown.combos.reduce((s, c) => s + c.probability, 0)
    expect(total).toBeCloseTo(1, 12)
    for (const combo of breakdown.combos) {
      if (combo.probability === 0) continue
      const direct = calculateEquity({ variant: 'holdem', players: [C('AhKh'), { cards: combo.cards }], board })
      expect(combo.equity[0]).toBeCloseTo(direct.players[0].equity, 12)
    }
    // Blocked combos (AhKh, QhQx with the board Qh) are filtered out before enumeration.
    expect(breakdown.combos.some((c) => c.cards.includes(parseCards('Ah')[0]))).toBe(false)
  })
})

describe('input validation', () => {
  const run = (req: EquityRequest) => () => calculateEquity(req)
  it('rejects duplicate cards', () => {
    expect(run({ variant: 'holdem', players: [C('AhKh'), C('AhQd')] })).toThrow(/used twice/)
    expect(run({ variant: 'holdem', players: [C('AhKh')], board: parseCards('Kh2c3d') })).toThrow(EquityInputError)
  })
  it('rejects cards outside the short deck', () => {
    expect(run({ variant: 'shortdeck', players: [C('AhKh'), C('5c5d')] })).toThrow(/not in the Short Deck deck/)
  })
  it('rejects too many hole cards, players or board cards', () => {
    expect(run({ variant: 'holdem', players: [C('AhKhQh')] })).toThrow(/deals 2/)
    expect(run({ variant: 'holdem', players: Array(11).fill({}) })).toThrow(/at most 10/)
    expect(run({ variant: 'holdem', players: [C('AhKh')], board: parseCards('2c3c4c5c6c7c') })).toThrow(/five cards/)
    expect(run({ variant: 'holdem', players: [] })).toThrow(/at least one/)
  })
  it('rejects ranges that cannot be dealt', () => {
    expect(run({ variant: 'holdem', players: [C('AhAs'), R('AA')], board: parseCards('Ad2c3c') })).toThrow(/empty once known cards/)
    expect(run({ variant: 'holdem', players: [R('AhKh'), R('AhKh')] })).toThrow(/cannot all be dealt/)
    expect(run({ variant: 'holdem', players: [C('Ah'), { cards: [], range: [] }] })).toThrow(/range is empty/)
    expect(run({ variant: 'holdem', players: [{ cards: parseCards('Ah'), range: R('AA').range }] })).toThrow(/both cards and a range/)
  })
  it('rejects deals that need more cards than the deck holds', () => {
    expect(run({ variant: 'shortdeck', players: Array(10).fill({}), dead: parseCards('AhAdAcAsKhKdKcKsQhQdQcQs') })).toThrow(/Not enough cards/)
  })
  it('forces exact mode only when enumerable', () => {
    expect(() => plan(prepare({ variant: 'holdem', players: [R('random'), R('random')] }), { method: 'exact', jointCap: 100 })).toThrow(
      /Too many range combinations/,
    )
  })
})

describe('auto method selection', () => {
  it('uses exact enumeration for small spots and Monte Carlo for large ones', () => {
    expect(plan(prepare({ variant: 'holdem', players: [C('AhKh'), C('QsQd')] })).method).toBe('exact')
    expect(plan(prepare({ variant: 'holdem', players: [C('AhKh'), {}, {}] })).method).toBe('montecarlo')
    expect(plan(prepare({ variant: 'holdem', players: [C('AhKh'), {}], board: parseCards('Qh7h2c') })).method).toBe('exact')
  })
})

describe('single player and partial hands', () => {
  it('reports hand-type chances for a lone player', () => {
    const r = calculateEquity({ variant: 'holdem', players: [C('AhKh')], board: parseCards('Qh7h2c') })
    expect(r.players[0].equity).toBe(1)
    const sum = r.players[0].categories.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 12)
    // Flush by the river: 9 hearts left in 47 cards over two draws, plus runner-runner none needed.
    const flushOrBetter = r.players[0].categories[5] + r.players[0].categories[8]
    expect(flushOrBetter).toBeCloseTo(1 - (38 * 37) / (47 * 46), 12)
  })
})

describe('next card analysis', () => {
  it('matches direct calculations card by card on the turn', () => {
    const req: EquityRequest = { variant: 'holdem', players: [C('AhKh'), C('QsQd')], board: parseCards('Jh7h2cQc') }
    const cards: number[] = []
    const results = nextCardAnalysis(req, { onCard: (r) => cards.push(r.card) })
    expect(results).toHaveLength(44)
    expect(cards).toHaveLength(44)
    for (const r of results.slice(0, 6)) {
      const direct = calculateEquity({ ...req, board: [...req.board!, r.card] })
      expect(r.equity![0]).toBeCloseTo(direct.players[0].equity, 12)
    }
  })
  it('returns nothing preflop or on the river', () => {
    expect(nextCardAnalysis({ variant: 'holdem', players: [C('AhKh'), C('QsQd')] })).toEqual([])
  })
  it('marks cards that make every range deal impossible', () => {
    const results = nextCardAnalysis({ variant: 'holdem', players: [C('AhKh'), R('QsQd')], board: parseCards('Jh7h2c') })
    const qs = results.find((r) => r.card === parseCards('Qs')[0])!
    expect(qs.equity).toBeUndefined()
  })
})

describe('currentHandValue', () => {
  it('describes made hands for Hold\'em and Omaha', () => {
    expect(describeValue(currentHandValue('holdem', parseCards('AhKh'), parseCards('As7h2h'))!)).toBe('Pair of Aces')
    expect(currentHandValue('holdem', parseCards('AhKh'), parseCards('As7h'))).toBeUndefined()
    expect(currentHandValue('holdem', parseCards('AhKh'), parseCards('Ah7h2c'))).toBeUndefined()
    // Omaha: four hearts in hand plus a one-heart board is not a flush.
    expect(describeValue(currentHandValue('omaha4', parseCards('AhKhQhJh'), parseCards('2h3c4d'))!)).toBe('High Card, Ace')
    expect(currentHandValue('omaha4', parseCards('AhKh'), parseCards('2h3c4d'))).toBeUndefined()
  })
})
