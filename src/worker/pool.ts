/**
 * Coordinates equity jobs across a pool of workers.
 *
 * Exact enumeration runs on a single worker. Monte Carlo runs one independent shard per worker
 * with its own seed; the pool merges each shard's latest raw totals and stops everything as soon
 * as the merged standard error reaches the target. Monte Carlo shards stop cooperatively (they check
 * for a stop message between short slices) so workers stay warm; synchronous jobs (exact, next card)
 * are aborted by terminating the worker and spawning a fresh one.
 */

import type { Card } from '../engine/cards.ts'
import {
  type EquityRequest,
  type EquityResult,
  type NextCardResult,
  type Prepared,
  type RawTotals,
  mergeRaw,
  prepare,
  summarize,
  worstStdErr,
} from '../engine/equity.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

export interface WorkerLike {
  postMessage(msg: ToWorker): void
  terminate(): void
  onmessage: ((event: { data: FromWorker }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export interface RunOptions {
  /** Stop Monte Carlo once the merged standard error of every player is at or below this. */
  targetStdErr: number
  timeLimitMs: number
  /** Monte Carlo trials never stop before this many samples. */
  minTrials?: number
  seed?: number
}

export interface EquityUpdate extends EquityResult {
  shards: number
}

export interface RunHandlers {
  onUpdate?: (result: EquityUpdate) => void
  onDone: (result: EquityUpdate) => void
  onError: (message: string, inputError: boolean) => void
}

export interface NextCardHandlers {
  onCard: (result: NextCardResult) => void
  onDone: () => void
  onError: (message: string) => void
}

export interface Job {
  cancel(): void
}

const MIN_TRIALS = 50_000

export class EquityPool {
  private workers: WorkerLike[] = []
  /** What each busy worker is doing: synchronous work must be terminated, Monte Carlo can be stopped. */
  private busy = new Map<number, { job: number; mode: 'sync' | 'montecarlo' }>()
  private nextJobId = 1
  private readonly factory: () => WorkerLike
  readonly size: number

  constructor(factory: () => WorkerLike, size: number) {
    this.factory = factory
    this.size = Math.max(1, Math.floor(size))
    for (let i = 0; i < this.size; i++) this.workers.push(factory())
  }

  /** Frees workers that are mid-job: stops Monte Carlo shards, terminates and replaces synchronous ones. */
  private reset(indices: Iterable<number>) {
    for (const i of [...indices]) {
      const state = this.busy.get(i)
      this.busy.delete(i)
      if (!state) continue
      this.workers[i].onmessage = null
      if (state.mode === 'montecarlo') {
        this.workers[i].postMessage({ type: 'stop', id: state.job })
        continue
      }
      this.workers[i].onerror = null
      this.workers[i].terminate()
      this.workers[i] = this.factory()
    }
  }

  dispose(): void {
    this.workers.forEach((w) => w.terminate())
    this.workers = []
    this.busy.clear()
  }

  run(request: EquityRequest, opts: RunOptions, handlers: RunHandlers): Job {
    const id = this.nextJobId++
    let finished = false
    const started = now()
    let prep: Prepared
    try {
      prep = prepare(request)
    } catch (err) {
      queueMicrotask(() => handlers.onError(err instanceof Error ? err.message : String(err), true))
      return { cancel: () => {} }
    }

    const snapshots = new Map<number, RawTotals>()
    const doneShards = new Set<number>()
    let method: 'exact' | 'montecarlo' | undefined
    let exactEvals = 0
    const used: number[] = []
    const baseSeed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0
    const minTrials = opts.minTrials ?? MIN_TRIALS

    const finish = () => {
      finished = true
      this.reset(used.filter((i) => this.busy.has(i)))
    }

    const mergedResult = (done: boolean): EquityUpdate => {
      let raw: RawTotals | undefined
      for (const snap of snapshots.values()) raw = raw ? mergeRaw(raw, snap) : snap
      const elapsedMs = now() - started
      const worst = raw ? worstStdErr(raw) : Infinity
      const precision = worst === Infinity ? 0 : Math.min(1, (opts.targetStdErr / Math.max(worst, 1e-12)) ** 2)
      const progress = done ? 1 : Math.min(1, Math.max(elapsedMs / opts.timeLimitMs, precision))
      const result = summarize(prep, raw!, 'montecarlo', { progress, done, elapsedMs, exactEvals })
      return { ...result, shards: snapshots.size }
    }

    const onMessage = (worker: number) => (event: { data: FromWorker }) => {
      const msg = event.data
      if (finished || msg.id !== id) return
      switch (msg.type) {
        case 'plan':
          method = msg.method
          exactEvals = msg.exactEvals
          if (method === 'montecarlo') {
            this.busy.set(worker, { job: id, mode: 'montecarlo' })
            for (let i = 1; i < this.size; i++) start(i, true)
          }
          return
        case 'progress':
        case 'done': {
          if (method !== 'montecarlo') {
            const update = { ...msg.result, elapsedMs: now() - started, shards: 1 }
            if (msg.type === 'done') {
              this.busy.delete(worker)
              finish()
              handlers.onDone(update)
            } else handlers.onUpdate?.(update)
            return
          }
          snapshots.set(worker, msg.result.raw)
          if (msg.type === 'done') {
            this.busy.delete(worker)
            doneShards.add(worker)
          }
          const merged = mergedResult(false)
          const converged = merged.samples >= minTrials && worstStdErr(merged.raw) <= opts.targetStdErr
          const timedOut = merged.elapsedMs >= opts.timeLimitMs
          if (converged || timedOut || doneShards.size === used.length) {
            finish()
            handlers.onDone({ ...merged, progress: 1, done: true })
          } else handlers.onUpdate?.(merged)
          return
        }
        case 'error':
          finish()
          handlers.onError(msg.message, msg.inputError)
          return
      }
    }

    const start = (worker: number, montecarlo: boolean) => {
      used.push(worker)
      this.busy.set(worker, { job: id, mode: montecarlo ? 'montecarlo' : 'sync' })
      const w = this.workers[worker]
      w.onmessage = onMessage(worker)
      w.onerror = (event) => {
        if (finished) return
        finish()
        handlers.onError(`Worker crashed: ${String((event as { message?: string })?.message ?? event)}`, false)
      }
      // Shards never stop on their own precision; the pool decides from the merged totals.
      const shardRequest: EquityRequest = {
        ...request,
        method: montecarlo ? 'montecarlo' : request.method,
        seed: (baseSeed + Math.imul(worker, 0x9e3779b9)) >>> 0,
        targetStdErr: 0,
        timeLimitMs: opts.timeLimitMs,
        maxTrials: Number.MAX_SAFE_INTEGER,
      }
      w.postMessage({ type: 'equity', id, request: shardRequest, announcePlan: worker === 0 })
    }

    this.reset([...this.busy.keys()])
    start(0, false)
    return {
      cancel: () => {
        if (finished) return
        finish()
      },
    }
  }

  nextCards(request: EquityRequest, cards: readonly Card[], handlers: NextCardHandlers, seed = (Math.random() * 2 ** 32) >>> 0): Job {
    const id = this.nextJobId++
    let finished = false
    const shards = Math.min(this.size, Math.max(1, cards.length))
    const used = Array.from({ length: shards }, (_, i) => i)
    let remaining = shards
    const finish = () => {
      finished = true
      this.reset(used.filter((i) => this.busy.has(i)))
    }
    this.reset([...this.busy.keys()])
    used.forEach((worker) => {
      const slice = cards.filter((_, i) => i % shards === worker)
      this.busy.set(worker, { job: id, mode: 'sync' })
      const w = this.workers[worker]
      w.onmessage = (event) => {
        const msg = event.data
        if (finished || msg.id !== id) return
        if (msg.type === 'nextCard') handlers.onCard(msg.result)
        else if (msg.type === 'nextCardDone') {
          this.busy.delete(worker)
          if (--remaining === 0) {
            finished = true
            handlers.onDone()
          }
        } else if (msg.type === 'error') {
          finish()
          handlers.onError(msg.message)
        }
      }
      w.onerror = (event) => {
        if (finished) return
        finish()
        handlers.onError(`Worker crashed: ${String((event as { message?: string })?.message ?? event)}`)
      }
      w.postMessage({ type: 'nextCard', id, request, cards: slice, seed: (seed + worker * 7919) >>> 0 })
    })
    return { cancel: () => !finished && finish() }
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Leaves one core for the UI thread and caps the pool for memory on phones. */
export function defaultPoolSize(hardwareConcurrency: number | undefined): number {
  const cores = hardwareConcurrency && hardwareConcurrency > 0 ? hardwareConcurrency : 4
  return Math.min(8, Math.max(1, cores - 1))
}
