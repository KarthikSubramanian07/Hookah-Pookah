import type { Card } from '../engine/cards.ts'
import type { EquityRequest, EquityResult, NextCardResult } from '../engine/equity.ts'

export type ToWorker =
  | { type: 'equity'; id: number; request: EquityRequest; announcePlan: boolean; sliceMs?: number }
  | { type: 'nextCard'; id: number; request: EquityRequest; cards: Card[]; seed: number }
  | { type: 'stop'; id: number }

export type FromWorker =
  | { type: 'plan'; id: number; method: 'exact' | 'montecarlo'; exactEvals: number }
  | { type: 'progress'; id: number; result: EquityResult }
  | { type: 'done'; id: number; result: EquityResult }
  | { type: 'nextCard'; id: number; result: NextCardResult }
  | { type: 'nextCardDone'; id: number }
  | { type: 'error'; id: number; message: string; inputError: boolean }
