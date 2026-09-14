import { describe, expect, it } from 'vitest'
import { parseCards } from '../src/engine/cards.ts'
import { type EquityRequest, calculateEquity } from '../src/engine/equity.ts'
import { comboFromKey, parseRange } from '../src/engine/ranges.ts'
import { createHandler } from '../src/worker/handler.ts'
import { EquityPool, type EquityUpdate, type WorkerLike, defaultPoolSize } from '../src/worker/pool.ts'
import type { FromWorker, ToWorker } from '../src/worker/protocol.ts'

/** In-process stand-in for a Web Worker: same handler, asynchronous message delivery. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: FromWorker }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  terminated = false
  received: ToWorker[] = []
  private readonly handle = createHandler((msg) => {
    if (!this.terminated) setTimeout(() => !this.terminated && this.onmessage?.({ data: msg }), 0)
  })
  postMessage(msg: ToWorker): void {
    this.received.push(msg)
    setTimeout(() => !this.terminated && this.handle(msg), 0)
  }
  terminate(): void {
    this.terminated = true
  }
}

function makePool(size: number) {
  const created: FakeWorker[] = []
  const pool = new EquityPool(() => {
    const w = new FakeWorker()
    created.push(w)
    return w
  }, size)
  return { pool, created }
}

const run = (pool: EquityPool, request: EquityRequest, targetStdErr = 0.002, timeLimitMs = 20_000) =>
  new Promise<{ result: EquityUpdate; updates: number }>((resolve, reject) => {
    let updates = 0
    pool.run(request, { targetStdErr, timeLimitMs, seed: 1234 }, {
      onUpdate: () => updates++,
      onDone: (result) => resolve({ result, updates }),
      onError: (message) => reject(new Error(message)),
    })
  })

describe('EquityPool', () => {
  it('returns exact results from a single worker', async () => {
    const { pool, created } = makePool(3)
    const request: EquityRequest = { variant: 'holdem', players: [{ cards: parseCards('AsAh') }, { cards: parseCards('KsKh') }] }
    const { result } = await run(pool, request)
    expect(result.method).toBe('exact')
    expect(result.players[0].equity).toBeCloseTo(0.826366, 6)
    expect(created[1].received).toHaveLength(0)
  })

  it('shards Monte Carlo across workers and stops at the merged target precision', async () => {
    const { pool, created } = makePool(3)
    const request: EquityRequest = { variant: 'holdem', players: [{ cards: parseCards('AhKh') }, {}, {}] }
    const { result } = await run(pool, request, 0.0008)
    expect(result.method).toBe('montecarlo')
    expect(result.done).toBe(true)
    expect(result.shards).toBeGreaterThan(1)
    expect(result.samples).toBeGreaterThanOrEqual(50_000)
    expect(Math.max(...result.players.map((p) => p.stdErr))).toBeLessThanOrEqual(0.0008)
    // Known value: AKs vs two random hands is about 50.7%.
    expect(Math.abs(result.players[0].equity - 0.507)).toBeLessThan(5 * result.players[0].stdErr + 0.002)
    // Converged shards are stopped cooperatively, never terminated.
    expect(created.every((w) => !w.terminated)).toBe(true)
    expect(created.some((w) => w.received.some((m) => m.type === 'stop'))).toBe(true)
  })

  it('reports input errors', async () => {
    const { pool } = makePool(2)
    await expect(run(pool, { variant: 'holdem', players: [{ cards: parseCards('AhAh') }] })).rejects.toThrow(/used twice/)
    await expect(
      run(pool, { variant: 'holdem', players: [{ range: [{ cards: parseCards('AhKh'), weight: 1 }] }, { range: [{ cards: parseCards('AhKh'), weight: 1 }] }] }),
    ).rejects.toThrow(/cannot all be dealt/)
  })

  it('cancels a running job without delivering results', async () => {
    const { pool } = makePool(2)
    let delivered = false
    const job = pool.run({ variant: 'holdem', players: [{ cards: parseCards('AhKh') }, {}, {}, {}] }, { targetStdErr: 1e-9, timeLimitMs: 60_000 }, {
      onDone: () => (delivered = true),
      onError: () => (delivered = true),
    })
    await new Promise((r) => setTimeout(r, 150))
    job.cancel()
    await new Promise((r) => setTimeout(r, 300))
    expect(delivered).toBe(false)
    // The pool is immediately usable again.
    const { result } = await run(pool, { variant: 'holdem', players: [{ cards: parseCards('QsQd') }, { cards: parseCards('JcTc') }] })
    expect(result.method).toBe('exact')
  })

  it('supersedes the previous job when a new one starts', async () => {
    const { pool } = makePool(2)
    let firstDelivered = false
    pool.run({ variant: 'holdem', players: [{ cards: parseCards('AhKh') }, {}, {}] }, { targetStdErr: 1e-9, timeLimitMs: 60_000 }, {
      onDone: () => (firstDelivered = true),
      onError: () => (firstDelivered = true),
    })
    const { result } = await run(pool, { variant: 'holdem', players: [{ cards: parseCards('7c7d') }, { cards: parseCards('AhKs') }] })
    expect(result.players[0].equity).toBeGreaterThan(0.5)
    expect(firstDelivered).toBe(false)
  })

  it('merges range breakdowns from every shard', async () => {
    const { pool } = makePool(2)
    const range = [...parseRange('QQ+, AKs').combos].map(([k, w]) => ({ cards: comboFromKey(k), weight: w }))
    const request: EquityRequest = { variant: 'holdem', players: [{ cards: parseCards('JhTh') }, { range }, {}], method: 'montecarlo' }
    const { result } = await run(pool, request, 0.004)
    const breakdown = result.ranges[0]
    expect(breakdown.combos.reduce((s, c) => s + c.probability, 0)).toBeCloseTo(1, 9)
  })

  it('runs next-card analysis across shards and matches the engine', async () => {
    const { pool } = makePool(3)
    const request: EquityRequest = { variant: 'holdem', players: [{ cards: parseCards('AhKh') }, { cards: parseCards('QsQd') }], board: parseCards('Jh7h2c') }
    const deck = Array.from({ length: 52 }, (_, i) => i).filter((c) => ![...parseCards('AhKhQsQdJh7h2c')].includes(c))
    const cards = await new Promise<Map<number, number>>((resolve, reject) => {
      const out = new Map<number, number>()
      pool.nextCards(request, deck, {
        onCard: (r) => out.set(r.card, r.equity![0]),
        onDone: () => resolve(out),
        onError: (m) => reject(new Error(m)),
      })
    })
    expect(cards.size).toBe(45)
    const turn = parseCards('Th')[0]
    const direct = calculateEquity({ ...request, board: [...request.board!, turn] })
    expect(cards.get(turn)).toBeCloseTo(direct.players[0].equity, 12)
  })

  it('sizes the pool sensibly', () => {
    expect(defaultPoolSize(undefined)).toBe(3)
    expect(defaultPoolSize(1)).toBe(1)
    expect(defaultPoolSize(8)).toBe(7)
    expect(defaultPoolSize(64)).toBe(8)
  })
})
