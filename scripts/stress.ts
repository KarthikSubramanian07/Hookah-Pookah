/**
 * Long-running verification suite (CI runs it weekly and on demand).
 *
 *   node scripts/stress.ts [--fuzz 400] [--calibration 600] [--skip-phe]
 *
 * 1. Exhaustive 7-card category counts for standard (133,784,560 hands) and both short deck rule sets.
 * 2. PokerHandEvaluator's published test corpus (5, 6, 7 card, PLO4, PLO5), downloaded and cached in
 *    .cache/phe: every hand must order identically to PHEvaluator's ranks.
 * 3. Differential fuzz of the exact engine against the brute-force oracle in tests/reference.ts.
 * 4. Monte Carlo calibration: 95% intervals must contain the exact answer about 95% of the time.
 * Exits non-zero on any failure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseCards } from '../src/engine/cards.ts'
import { type EquityRequest, calculateEquity, plan, prepare, runExact, runMonteCarlo } from '../src/engine/equity.ts'
import { RULES_SHORT_CLASSIC, RULES_SHORT_TRITON, RULES_STANDARD, type Rules, categoryOf, evaluate, evaluateOmaha } from '../src/engine/evaluator.ts'
import { comboFromKey, parseRange } from '../src/engine/ranges.ts'
import { Rng } from '../src/engine/rng.ts'
import { REF_SHORT_CLASSIC, REF_SHORT_TRITON, REF_STANDARD, refEquity } from '../tests/reference.ts'

const { values: args } = parseArgs({
  options: {
    fuzz: { type: 'string', default: '400' },
    calibration: { type: 'string', default: '600' },
    'skip-phe': { type: 'boolean', default: false },
  },
})

const root = fileURLToPath(new URL('..', import.meta.url))
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const timed = <T>(fn: () => T): [T, string] => {
  const t = performance.now()
  const out = fn()
  return [out, `${((performance.now() - t) / 1000).toFixed(1)} s`]
}

// 1. Exhaustive counts ---------------------------------------------------------------------------

function sevenCardCounts(rules: Rules, lowRank: number) {
  const deck: number[] = []
  for (let c = lowRank * 4; c < 52; c++) deck.push(c)
  const counts = new Array(9).fill(0)
  const distinct = new Set<number>()
  const n = deck.length
  const m = new Int32Array(28) // suit masks after 0..6 cards, 4 per level
  for (let a = 0; a < n - 6; a++) {
    m.fill(0, 0, 4)
    m[deck[a] & 3] = 1 << (deck[a] >> 2)
    for (let b = a + 1; b < n - 5; b++) {
      m.set(m.subarray(0, 4), 4)
      m[4 + (deck[b] & 3)] |= 1 << (deck[b] >> 2)
      for (let c = b + 1; c < n - 4; c++) {
        m.set(m.subarray(4, 8), 8)
        m[8 + (deck[c] & 3)] |= 1 << (deck[c] >> 2)
        for (let d = c + 1; d < n - 3; d++) {
          m.set(m.subarray(8, 12), 12)
          m[12 + (deck[d] & 3)] |= 1 << (deck[d] >> 2)
          for (let e = d + 1; e < n - 2; e++) {
            m.set(m.subarray(12, 16), 16)
            m[16 + (deck[e] & 3)] |= 1 << (deck[e] >> 2)
            for (let f = e + 1; f < n - 1; f++) {
              m.set(m.subarray(16, 20), 20)
              m[20 + (deck[f] & 3)] |= 1 << (deck[f] >> 2)
              for (let g = f + 1; g < n; g++) {
                const s = deck[g] & 3
                const bit = 1 << (deck[g] >> 2)
                const v = rules.evalMasks(m[20] | (s === 0 ? bit : 0), m[21] | (s === 1 ? bit : 0), m[22] | (s === 2 ? bit : 0), m[23] | (s === 3 ? bit : 0), 7)
                counts[categoryOf(v)]++
                distinct.add(v)
              }
            }
          }
        }
      }
    }
  }
  return { counts, distinct: distinct.size }
}

{
  const [std, t] = timed(() => sevenCardCounts(RULES_STANDARD, 0))
  check(
    '7-card category counts, 52 cards',
    JSON.stringify(std.counts) === JSON.stringify([23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584]) && std.distinct === 4824,
    t,
  )
  const [tri] = timed(() => sevenCardCounts(RULES_SHORT_TRITON, 4))
  check('7-card counts, short deck Triton', JSON.stringify(tri.counts) === JSON.stringify([233100, 2316600, 3157056, 637560, 1139580, 175560, 633024, 44640, 10560]) && tri.distinct === 762)
  const [cla] = timed(() => sevenCardCounts(RULES_SHORT_CLASSIC, 4))
  check('7-card counts, short deck classic', JSON.stringify(cla.counts) === JSON.stringify([233100, 2316600, 3157056, 607200, 1169940, 175560, 633024, 44640, 10560]) && cla.distinct === 752)
}

// 2. PokerHandEvaluator corpus ------------------------------------------------------------------

async function pheCorpus() {
  const cache = `${root}.cache/phe`
  mkdirSync(cache, { recursive: true })
  const sets: [string, (c: number[]) => number][] = [
    ['five', (c) => evaluate(c)],
    ['six', (c) => evaluate(c)],
    ['seven', (c) => evaluate(c)],
    ['plo4', (c) => evaluateOmaha(c.slice(5), c.slice(0, 5))],
    ['plo5', (c) => evaluateOmaha(c.slice(5), c.slice(0, 5))],
  ]
  for (const [name, score] of sets) {
    const file = `${cache}/${name}.csv`
    if (!existsSync(file)) {
      const url = `https://raw.githubusercontent.com/HenryRLee/PokerHandEvaluator/master/test_data/${name}/id_input_tests.csv`
      let body: string | undefined
      let lastError = ''
      for (let attempt = 1; attempt <= 4 && body === undefined; attempt++) {
        try {
          const res = await fetch(url)
          if (res.ok) body = await res.text()
          else lastError = `HTTP ${res.status}`
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          await new Promise((r) => setTimeout(r, attempt * 1500))
        }
      }
      if (body === undefined) {
        check(`PHEvaluator corpus ${name}`, false, `download failed: ${lastError}`)
        continue
      }
      writeFileSync(file, body)
    }
    const lines = readFileSync(file, 'utf8').trim().split('\n').slice(1)
    const pheToMine = new Map<number, number>()
    const mineToPhe = new Map<number, number>()
    let inconsistent = 0
    for (const line of lines) {
      const nums = line.split(',').map(Number)
      const rank = nums.pop()!
      const v = score(nums)
      const a = pheToMine.get(rank)
      if (a === undefined) pheToMine.set(rank, v)
      else if (a !== v) inconsistent++
      const b = mineToPhe.get(v)
      if (b === undefined) mineToPhe.set(v, rank)
      else if (b !== rank) inconsistent++
    }
    const sorted = [...pheToMine.entries()].sort((x, y) => x[0] - y[0])
    let violations = 0
    for (let i = 1; i < sorted.length; i++) if (!(sorted[i][1] < sorted[i - 1][1])) violations++
    check(`PHEvaluator corpus ${name}`, inconsistent === 0 && violations === 0, `${lines.length} hands, ${inconsistent} inconsistent, ${violations} order violations`)
  }
}
if (!args['skip-phe']) await pheCorpus()

// 3. Differential fuzz ---------------------------------------------------------------------------

{
  const variants = [
    { id: 'holdem', low: 0, rules: REF_STANDARD, omaha: false, hc: 2, sd: undefined },
    { id: 'shortdeck', low: 4, rules: REF_SHORT_TRITON, omaha: false, hc: 2, sd: 'triton' },
    { id: 'shortdeck', low: 4, rules: REF_SHORT_CLASSIC, omaha: false, hc: 2, sd: 'classic' },
    { id: 'omaha4', low: 0, rules: REF_STANDARD, omaha: true, hc: 4, sd: undefined },
    { id: 'omaha5', low: 0, rules: REF_STANDARD, omaha: true, hc: 5, sd: undefined },
  ] as const
  const rng = new Rng(20260914)
  const total = Number(args.fuzz)
  let compared = 0
  let worst = 0
  const [, t] = timed(() => {
    for (let it = 0; it < total; it++) {
      const v = variants[rng.nextInt(variants.length)]
      const deck: number[] = []
      for (let c = v.low * 4; c < 52; c++) deck.push(c)
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1)
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      let top = 0
      const boardLen = 3 + rng.nextInt(3)
      const board = deck.slice(top, (top += boardLen))
      const dead = deck.slice(top, (top += rng.nextInt(3)))
      const n = 2 + rng.nextInt(v.omaha ? 2 : 3)
      const players: { cards?: number[]; range?: { cards: number[]; weight: number }[] }[] = []
      let unknown = 5 - boardLen
      for (let p = 0; p < n; p++) {
        const kind = rng.nextInt(4)
        if (kind === 0 && !v.omaha) {
          const range: { cards: number[]; weight: number }[] = []
          for (let i = 0; i < 1 + rng.nextInt(6); i++) {
            const a = deck[top + rng.nextInt(12)]
            const b = deck[top + rng.nextInt(12)]
            if (a !== b && !range.some((r) => r.cards.includes(a) && r.cards.includes(b))) range.push({ cards: [a, b], weight: [1, 0.75, 0.5, 0.25][rng.nextInt(4)] })
          }
          if (range.length) {
            players.push({ range })
            continue
          }
        }
        if (kind === 1 && unknown >= 1) {
          players.push({ cards: deck.slice(top, (top += v.hc - 1)) })
          unknown--
          continue
        }
        players.push({ cards: deck.slice(top, (top += v.hc)) })
      }
      const req: EquityRequest = { variant: v.id, shortDeckRules: v.sd, players, board, dead, method: 'exact' }
      let mine
      try {
        mine = calculateEquity(req)
      } catch {
        continue
      }
      const ref = refEquity({ lowRank: v.low, rules: v.rules, omaha: v.omaha, holeCount: v.hc, board, dead, players })
      for (let p = 0; p < n; p++) {
        worst = Math.max(worst, Math.abs(mine.players[p].equity - ref.equity[p]), Math.abs(mine.players[p].tie - ref.tie[p]))
        for (let k = 0; k < 9; k++) worst = Math.max(worst, Math.abs(mine.players[p].categories[k] - ref.categories[p][k]))
      }
      compared++
    }
  })
  check(`differential fuzz vs brute force`, worst < 1e-9 && compared > total * 0.6, `${compared} scenarios, max diff ${worst.toExponential(1)}, ${t}`)
}

// 4. Reference equities -------------------------------------------------------------------------

{
  const C = (s: string) => ({ cards: parseCards(s) })
  const R = (s: string) => ({ range: [...parseRange(s).combos].map(([k, w]) => ({ cards: comboFromKey(k), weight: w })) })
  const refs: [string, EquityRequest, number][] = [
    ['AA vs KK (ranges)', { variant: 'holdem', players: [R('AA'), R('KK')] }, 81.94605],
    ['AKs vs QQ (ranges)', { variant: 'holdem', players: [R('AKs'), R('QQ')] }, 46.04853],
    ['AKo vs QQ (ranges)', { variant: 'holdem', players: [R('AKo'), R('QQ')] }, 43.24234],
    ['AA vs 72o (ranges)', { variant: 'holdem', players: [R('AA'), R('72o')] }, 88.19963],
    ['AK vs 22 (ranges)', { variant: 'holdem', players: [R('AK'), R('22')] }, 47.98646],
    ['AsAh vs one random hand', { variant: 'holdem', players: [C('AsAh'), R('random')], exactEvalLimit: Infinity }, 85.2037],
  ]
  for (const [name, req, expected] of refs) {
    const [r, t] = timed(() => calculateEquity({ ...req, method: 'exact' }))
    const got = r.players[0].equity * 100
    check(`exact ${name}`, Math.abs(got - expected) < 6e-5, `${got.toFixed(5)}% vs ${expected}%, ${t}`)
  }
}

// 5. Monte Carlo calibration ----------------------------------------------------------------------

{
  const runs = Number(args.calibration)
  const cases: EquityRequest[] = [
    { variant: 'holdem', players: [{ cards: parseCards('AhKh') }, {}, {}], board: parseCards('Jh7h2cQd') },
    { variant: 'omaha4', players: [{ cards: parseCards('AhKhQsJs') }, {}], board: parseCards('Th9h2c8d') },
    { variant: 'shortdeck', players: [{ cards: parseCards('AsKs') }, {}], board: parseCards('Ah9h6c') },
  ]
  for (const req of cases) {
    const prep = prepare(req)
    const exact = runExact(prep, plan(prep, { method: 'exact' }))
    const mcPlan = plan(prep, { method: 'montecarlo' })
    let inside = 0
    let z2 = 0
    for (let s = 0; s < runs; s++) {
      const mc = runMonteCarlo(prep, mcPlan, { seed: 1_000_003 * (s + 1), maxTrials: 10_000, targetStdErr: 0, timeLimitMs: 60_000 })
      const z = (mc.players[0].equity - exact.players[0].equity) / mc.players[0].stdErr
      if (Math.abs(z) <= 1.959964) inside++
      z2 += z * z
    }
    const coverage = inside / runs
    // Binomial sd of coverage at 95% over `runs` trials; allow 4 sd.
    const tolerance = 4 * Math.sqrt((0.95 * 0.05) / runs)
    check(`calibration ${req.variant}`, Math.abs(coverage - 0.95) <= tolerance, `coverage ${(coverage * 100).toFixed(1)}%, var z ${(z2 / runs).toFixed(3)}`)
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll stress checks passed')
process.exit(failures ? 1 : 0)
