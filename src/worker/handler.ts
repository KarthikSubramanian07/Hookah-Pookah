import {
  EquityInputError,
  type EquityResult,
  type RawTotals,
  mergeRaw,
  nextCardAnalysis,
  plan,
  prepare,
  runExact,
  runMonteCarlo,
  summarize,
} from '../engine/equity.ts'
import { Rng } from '../engine/rng.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

export type Post = (msg: FromWorker) => void
/** Yields to the event loop so queued messages (stop, newer jobs) get delivered. */
export type Yield = () => Promise<void>

const defaultYield: Yield = () => new Promise((resolve) => setTimeout(resolve, 0))
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Worker-side job runner. A worker only ever works on its newest job: any new job or a stop message
 * ends the current Monte Carlo run at the next slice boundary. Exact enumeration and next-card analysis
 * run synchronously (they are fast after suit merging); the pool terminates the worker to abort them.
 */
export function createHandler(post: Post, yieldToLoop: Yield = defaultYield) {
  let current = 0
  const stopped = new Set<number>()

  const fail = (id: number, err: unknown) =>
    post({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
      inputError: err instanceof EquityInputError,
    })

  async function runEquity(msg: Extract<ToWorker, { type: 'equity' }>) {
    const { request, id } = msg
    const prep = prepare(request)
    const planned = plan(prep, request)
    if (msg.announcePlan) post({ type: 'plan', id, method: planned.method, exactEvals: planned.exactEvals })
    const onProgress = (result: EquityResult) => post({ type: 'progress', id, result })

    if (planned.method === 'exact') {
      post({ type: 'done', id, result: runExact(prep, planned, onProgress) })
      return
    }

    const started = now()
    const sliceMs = msg.sliceMs ?? 60
    const timeLimit = request.timeLimitMs ?? 12_000
    const maxTrials = request.maxTrials ?? Number.MAX_SAFE_INTEGER
    const target = request.targetStdErr ?? 0
    const seeds = new Rng(request.seed)
    let raw: RawTotals | undefined
    for (;;) {
      const slice = runMonteCarlo(prep, planned, {
        seed: seeds.nextU32(),
        targetStdErr: 0,
        timeLimitMs: sliceMs,
        maxTrials: Math.max(1, Math.min(maxTrials - (raw?.samples ?? 0), Number.MAX_SAFE_INTEGER)),
      })
      raw = raw ? mergeRaw(raw, slice.raw) : slice.raw
      const elapsedMs = now() - started
      const snapshot = summarize(prep, raw, 'montecarlo', { progress: 0, done: false, elapsedMs, exactEvals: planned.exactEvals })
      const worst = Math.max(...snapshot.players.map((p) => p.stdErr))
      const finished =
        raw.samples >= maxTrials || elapsedMs >= timeLimit || (target > 0 && raw.samples >= 50_000 && worst <= target)
      if (finished) {
        post({ type: 'done', id, result: { ...snapshot, progress: 1, done: true } })
        return
      }
      post({ type: 'progress', id, result: snapshot })
      await yieldToLoop()
      if (stopped.has(id) || current !== id) {
        stopped.delete(id)
        post({ type: 'done', id, result: { ...snapshot, progress: 1, done: true } })
        return
      }
    }
  }

  return function handle(msg: ToWorker): Promise<void> | void {
    if (msg.type === 'stop') {
      stopped.add(msg.id)
      return
    }
    current = msg.id
    try {
      if (msg.type === 'equity') return runEquity(msg).catch((err) => fail(msg.id, err))
      nextCardAnalysis(msg.request, {
        cards: msg.cards,
        seed: msg.seed,
        onCard: (result) => post({ type: 'nextCard', id: msg.id, result }),
      })
      post({ type: 'nextCardDone', id: msg.id })
    } catch (err) {
      fail(msg.id, err)
    }
  }
}
