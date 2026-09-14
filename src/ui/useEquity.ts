import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from '../engine/cards.ts'
import type { EquityRequest } from '../engine/equity.ts'
import { deckFor } from '../engine/variants.ts'
import { type CompiledSpot, type Spot, compileSpot, usedCards } from '../state/spot.ts'
import { EquityPool, type EquityUpdate, type Job, type WorkerLike, defaultPoolSize } from '../worker/pool.ts'
import EquityWorker from '../worker/equity.worker.ts?worker'

export type Precision = 'fast' | 'standard' | 'fine'

/** 95% interval half-width targets in percentage points. */
export const PRECISION_HALF_WIDTH: Record<Precision, number> = { fast: 0.5, standard: 0.1, fine: 0.02 }
const Z95 = 1.959964

export interface EquityState {
  compiled: CompiledSpot
  status: 'idle' | 'running' | 'done' | 'error' | 'invalid'
  result?: EquityUpdate
  error?: string
  /** Hero-perspective next-card equities by card, for flop and turn spots. */
  nextCards: Map<Card, number[] | undefined>
  nextStatus: 'idle' | 'running' | 'done' | 'error'
  nextTotal: number
  /** Stop the current Monte Carlo run and keep what it has so far. */
  stop: () => void
  rerun: () => void
}

let sharedPool: EquityPool | undefined
function pool(): EquityPool {
  if (!sharedPool) {
    const size = defaultPoolSize(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined)
    sharedPool = new EquityPool(() => new EquityWorker() as unknown as WorkerLike, size)
  }
  return sharedPool
}

const DEBOUNCE_MS = 140
const TIME_LIMIT_MS = 45_000

export function useEquity(spot: Spot, precision: Precision): EquityState {
  const compiled = useMemo(() => compileSpot(spot), [spot])
  const [runKey, setRunKey] = useState(0)
  const [status, setStatus] = useState<EquityState['status']>('idle')
  const [result, setResult] = useState<EquityUpdate>()
  const [error, setError] = useState<string>()
  const [nextCards, setNextCards] = useState<Map<Card, number[] | undefined>>(new Map())
  const [nextStatus, setNextStatus] = useState<EquityState['nextStatus']>('idle')
  const [nextTotal, setNextTotal] = useState(0)
  const jobs = useRef<{ main?: Job; next?: Job }>({})
  const latest = useRef<EquityUpdate | undefined>(undefined)

  const requestKey = compiled.request ? JSON.stringify(compiled.request) : ''

  useEffect(() => {
    const running = jobs.current
    running.main?.cancel()
    running.next?.cancel()
    const request = compiled.request
    if (!request) {
      setStatus('invalid')
      setResult(undefined)
      setNextCards(new Map())
      setNextStatus('idle')
      return
    }
    setStatus('running')
    setError(undefined)
    setNextCards(new Map())
    setNextStatus('idle')

    const timer = setTimeout(() => {
      const targetStdErr = PRECISION_HALF_WIDTH[precision] / 100 / Z95
      running.main = pool().run(
        request,
        { targetStdErr, timeLimitMs: TIME_LIMIT_MS },
        {
          onUpdate: (r) => {
            latest.current = r
            setResult(r)
          },
          onDone: (r) => {
            latest.current = r
            setResult(r)
            setStatus('done')
            startNextCards(request)
          },
          onError: (message) => {
            setError(message)
            setStatus('error')
            setResult(undefined)
          },
        },
      )
    }, DEBOUNCE_MS)

    const startNextCards = (req: EquityRequest) => {
      const boardLength = req.board?.length ?? 0
      if (boardLength !== 3 && boardLength !== 4) return
      const used = usedCards(spot)
      const cards = deckFor(req.variant).filter((c) => !used.has(c))
      setNextTotal(cards.length)
      setNextStatus('running')
      const collected = new Map<Card, number[] | undefined>()
      let flushTimer: ReturnType<typeof setTimeout> | undefined
      const flush = () => {
        flushTimer = undefined
        setNextCards(new Map(collected))
      }
      running.next = pool().nextCards(req, cards, {
        onCard: (r) => {
          collected.set(r.card, r.equity)
          flushTimer ??= setTimeout(flush, 80)
        },
        onDone: () => {
          if (flushTimer) clearTimeout(flushTimer)
          flush()
          setNextStatus('done')
        },
        onError: () => setNextStatus('error'),
      })
    }

    return () => {
      clearTimeout(timer)
      running.main?.cancel()
      running.next?.cancel()
    }
    // requestKey captures every input that changes the calculation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, precision, runKey])

  return {
    compiled,
    status,
    result,
    error,
    nextCards,
    nextStatus,
    nextTotal,
    stop: () => {
      if (status !== 'running') return
      jobs.current.main?.cancel()
      if (latest.current) setResult({ ...latest.current, done: true, progress: 1 })
      setStatus('done')
    },
    rerun: () => setRunKey((k) => k + 1),
  }
}
