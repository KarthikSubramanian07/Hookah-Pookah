/**
 * Generates src/engine/preflopRanking.ts: every starting hand class ordered by all-in preflop equity
 * against one random hand and against three random hands (the PokerStove / Equilab convention),
 * for Hold'em and Short Deck (Triton rules).
 *
 * Against one random hand the equities are exact (every opponent holding and every board, with suit
 * merging). Against three random hands they are seeded Monte Carlo, so output is reproducible.
 * Usage: node scripts/gen-preflop-ranking.ts [trialsPerClassVs3]
 */

import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { calculateEquity } from '../src/engine/equity.ts'
import { RULES_SHORT_TRITON, RULES_STANDARD } from '../src/engine/evaluator.ts'
import { Rng } from '../src/engine/rng.ts'
import { FastScorer } from '../src/engine/scorer.ts'
import { classGrid, comboFromKey, combosOfClass, parseRange } from '../src/engine/ranges.ts'

type Deck = 'holdem' | 'shortdeck'
interface Job {
  deck: Deck
  opponents: number
  label: string
  high: number
  low: number
  kind: 'pair' | 'suited' | 'offsuit'
  trials: number
  seed: number
}

function exactVsOne(job: Job): number {
  const hero = combosOfClass(job.high, job.low, job.kind)[0]
  const random = [...parseRange('random', job.deck).combos.keys()].map((key) => ({ cards: comboFromKey(key), weight: 1 }))
  const result = calculateEquity({ variant: job.deck, players: [{ cards: hero }, { range: random }], method: 'exact', exactEvalLimit: Infinity })
  return result.players[0].equity
}

function simulate(job: Job): number {
  if (job.opponents === 1) return exactVsOne(job)
  const rules = job.deck === 'shortdeck' ? RULES_SHORT_TRITON : RULES_STANDARD
  const players = job.opponents + 1
  const scorer = new FastScorer(rules, players, 2, false)
  const [h1, h2] = combosOfClass(job.high, job.low, job.kind)[0]
  const deck: number[] = []
  for (let c = job.deck === 'shortdeck' ? 16 : 0; c < 52; c++) if (c !== h1 && c !== h2) deck.push(c)
  const rng = new Rng(job.seed)
  const n = deck.length
  const need = job.opponents * 2 + 5
  const hole = new Int32Array(players * 2)
  const board = new Int32Array(5)
  const values = new Int32Array(players)
  hole[0] = h1
  hole[1] = h2
  scorer.setPlayer(0, hole)
  let equity = 0

  for (let t = 0; t < job.trials; t++) {
    for (let i = 0; i < need; i++) {
      const j = i + rng.nextInt(n - i)
      const tmp = deck[i]
      deck[i] = deck[j]
      deck[j] = tmp
    }
    for (let o = 0; o < job.opponents; o++) {
      hole[2 + o * 2] = deck[o * 2]
      hole[3 + o * 2] = deck[o * 2 + 1]
      scorer.setPlayer(o + 1, hole)
    }
    for (let i = 0; i < 5; i++) board[i] = deck[job.opponents * 2 + i]
    scorer.score(board, values)
    const hero = values[0]
    let winners = 0
    let heroBest = true
    for (let p = 0; p < players; p++) {
      if (values[p] > hero) {
        heroBest = false
        break
      }
      if (values[p] === hero) winners++
    }
    if (heroBest) equity += 1 / winners
  }
  return equity / job.trials
}

if (!isMainThread) {
  const jobs = workerData as Job[]
  for (const job of jobs) parentPort!.postMessage({ label: job.label, deck: job.deck, opponents: job.opponents, equity: simulate(job) })
  process.exit(0)
}

const trials = Number(process.argv[2] ?? 20_000_000)
const jobs: Job[] = []
let seed = 20260914
for (const deck of ['holdem', 'shortdeck'] as const)
  for (const opponents of [1, 3])
    for (const cls of classGrid(deck).flat()) jobs.push({ deck, opponents, ...cls, trials, seed: seed++ })

const threads = Math.max(1, availableParallelism())
const buckets: Job[][] = Array.from({ length: threads }, () => [])
// Interleave so every thread gets a similar mix of cheap (1 opponent) and expensive (3 opponent) jobs.
jobs.forEach((job, i) => buckets[i % threads].push(job))

const results = new Map<string, number>()
jobs.sort((a, b) => b.opponents - a.opponents)
buckets.forEach((b) => (b.length = 0))
jobs.forEach((job, i) => buckets[i % threads].push(job))
const started = Date.now()
await Promise.all(
  buckets.map(
    (bucket) =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: bucket })
        worker.on('message', (msg: { label: string; deck: Deck; opponents: number; equity: number }) => {
          results.set(`${msg.deck}|${msg.opponents}|${msg.label}`, msg.equity)
          if (results.size % 50 === 0) console.log(`${results.size}/${jobs.length} classes, ${((Date.now() - started) / 1000).toFixed(0)}s`)
        })
        worker.on('error', reject)
        worker.on('exit', () => resolve())
      }),
  ),
)

const table: Record<string, { label: string; equity: number }[]> = {}
for (const deck of ['holdem', 'shortdeck'] as const)
  for (const opponents of [1, 3]) {
    table[`${deck}_vs${opponents}`] = classGrid(deck)
      .flat()
      .map((c) => ({ label: c.label, equity: results.get(`${deck}|${opponents}|${c.label}`)! }))
      .sort((a, b) => b.equity - a.equity || a.label.localeCompare(b.label))
  }

const fmt = (list: { label: string; equity: number }[]) =>
  `[\n${list.map((e) => `    ['${e.label}', ${e.equity.toFixed(5)}],`).join('\n')}\n  ]`

const out = `// Generated by scripts/gen-preflop-ranking.ts: vs1 exact, vs3 ${trials.toLocaleString('en-US')} seeded Monte Carlo trials per class.
// Do not edit by hand. Each entry: [hand class, all-in preflop equity], strongest first.

export type RankingId = 'vs1' | 'vs3'

export const PREFLOP_EQUITY: Record<'holdem' | 'shortdeck', Record<RankingId, readonly (readonly [string, number])[]>> = {
  holdem: {
    vs1: ${fmt(table.holdem_vs1)},
    vs3: ${fmt(table.holdem_vs3)},
  },
  shortdeck: {
    vs1: ${fmt(table.shortdeck_vs1)},
    vs3: ${fmt(table.shortdeck_vs3)},
  },
}
`
const target = fileURLToPath(new URL('../src/engine/preflopRanking.ts', import.meta.url))
writeFileSync(target, out)
console.log(`Wrote ${target} in ${((Date.now() - started) / 1000).toFixed(0)}s`)
