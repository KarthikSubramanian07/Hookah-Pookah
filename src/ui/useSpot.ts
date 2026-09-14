import { useCallback, useReducer } from 'react'
import type { Card } from '../engine/cards.ts'
import type { RankingId } from '../engine/preflopRanking.ts'
import type { ShortDeckRules, VariantId } from '../engine/variants.ts'
import { BOARD_SIZE, VARIANTS, deckFor } from '../engine/variants.ts'
import { MAX_DEAD, type PlayerMode, type Spot, defaultSpot, emptyPlayer, usedCards } from '../state/spot.ts'

export type SlotRef = { kind: 'player'; player: number; slot: number } | { kind: 'board'; slot: number } | { kind: 'dead'; slot: number }

export type SpotAction =
  | { type: 'replace'; spot: Spot }
  | { type: 'variant'; variant: VariantId }
  | { type: 'card'; ref: SlotRef; card: Card | null }
  | { type: 'mode'; player: number; mode: PlayerMode }
  /** `typing` edits merge into one undo step; grid and preset edits are each their own step. */
  | { type: 'range'; player: number; text: string; typing?: boolean }
  | { type: 'addPlayer'; mode?: PlayerMode; range?: string }
  | { type: 'removePlayer'; player: number }
  | { type: 'movePlayer'; player: number; delta: -1 | 1 }
  | { type: 'clearPlayer'; player: number }
  | { type: 'clearBoard' }
  | { type: 'clearDead' }
  | { type: 'clearAll' }
  | { type: 'rules'; rules: ShortDeckRules }
  | { type: 'ranking'; ranking: RankingId }
  | { type: 'dealBoard'; upTo: 3 | 4 | 5; random: () => number }
  | { type: 'undo' }
  | { type: 'redo' }

export interface SpotState {
  spot: Spot
  past: Spot[]
  future: Spot[]
  /** Last spot seen per variant, restored when switching back. */
  byVariant: Partial<Record<VariantId, Spot>>
  /** Merges consecutive edits of the same kind (typing a range) into one undo step. */
  lastCoalesce?: string
  lastAt: number
}

const HISTORY_LIMIT = 150
const COALESCE_MS = 1200

/** Removes `card` from wherever it currently sits in the spot. */
function withoutCard(spot: Spot, card: Card): Spot {
  return {
    ...spot,
    players: spot.players.map((p) => (p.cards.includes(card) ? { ...p, cards: p.cards.map((c) => (c === card ? null : c)) } : p)),
    board: spot.board.map((c) => (c === card ? null : c)),
    dead: spot.dead.filter((c) => c !== card),
  }
}

export function applyAction(spot: Spot, action: SpotAction): Spot {
  const info = VARIANTS[spot.variant]
  switch (action.type) {
    case 'replace':
      return action.spot
    case 'card': {
      const { ref, card } = action
      let next = card === null ? spot : withoutCard(spot, card)
      if (ref.kind === 'player') {
        next = {
          ...next,
          players: next.players.map((p, i) =>
            i === ref.player ? { ...p, mode: 'cards', cards: p.cards.map((c, j) => (j === ref.slot ? card : c)) } : p,
          ),
        }
      } else if (ref.kind === 'board') {
        const board = [...next.board]
        board[ref.slot] = card
        next = { ...next, board }
      } else {
        const dead = [...next.dead]
        if (card === null) dead.splice(ref.slot, 1)
        else if (ref.slot < dead.length) dead[ref.slot] = card
        else if (dead.length < MAX_DEAD) dead.push(card)
        next = { ...next, dead }
      }
      return next
    }
    case 'mode':
      if (!info.supportsRanges && action.mode === 'range') return spot
      return { ...spot, players: spot.players.map((p, i) => (i === action.player ? { ...p, mode: action.mode } : p)) }
    case 'range':
      return { ...spot, players: spot.players.map((p, i) => (i === action.player ? { ...p, mode: 'range', range: action.text } : p)) }
    case 'addPlayer': {
      if (spot.players.length >= info.maxPlayers) return spot
      const player = emptyPlayer(spot.variant, action.mode === 'range' && info.supportsRanges ? 'range' : 'cards')
      if (action.range !== undefined) player.range = action.range
      return { ...spot, players: [...spot.players, player] }
    }
    case 'removePlayer':
      if (spot.players.length <= 1) return spot
      return { ...spot, players: spot.players.filter((_, i) => i !== action.player) }
    case 'movePlayer': {
      const to = action.player + action.delta
      if (to < 0 || to >= spot.players.length) return spot
      const players = [...spot.players]
      ;[players[action.player], players[to]] = [players[to], players[action.player]]
      return { ...spot, players }
    }
    case 'clearPlayer':
      return {
        ...spot,
        players: spot.players.map((p, i) => (i === action.player ? { ...p, cards: p.cards.map(() => null), range: p.mode === 'range' ? '' : p.range } : p)),
      }
    case 'clearBoard':
      return { ...spot, board: Array(BOARD_SIZE).fill(null) }
    case 'clearDead':
      return { ...spot, dead: [] }
    case 'clearAll':
      return {
        ...spot,
        players: spot.players.map((p) => ({ ...p, mode: 'cards', cards: p.cards.map(() => null), range: '' })),
        board: Array(BOARD_SIZE).fill(null),
        dead: [],
      }
    case 'rules':
      return { ...spot, shortDeckRules: action.rules }
    case 'ranking':
      return { ...spot, ranking: action.ranking }
    case 'dealBoard': {
      const used = usedCards(spot)
      const available = deckFor(spot.variant).filter((c) => !used.has(c))
      const board = [...spot.board]
      // Keep existing cards left-aligned, then fill up to the requested street.
      const kept = board.filter((c): c is Card => c !== null).slice(0, action.upTo)
      const next: (Card | null)[] = [...kept]
      while (next.length < action.upTo && available.length) {
        const i = Math.floor(action.random() * available.length)
        next.push(available.splice(i, 1)[0])
      }
      while (next.length < BOARD_SIZE) next.push(null)
      return { ...spot, board: next }
    }
    default:
      return spot
  }
}

export function spotReducer(state: SpotState, action: SpotAction): SpotState {
  if (action.type === 'undo') {
    if (!state.past.length) return state
    const previous = state.past[state.past.length - 1]
    return { ...state, spot: previous, past: state.past.slice(0, -1), future: [state.spot, ...state.future], lastCoalesce: undefined }
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state
    const [next, ...rest] = state.future
    return { ...state, spot: next, past: [...state.past, state.spot], future: rest, lastCoalesce: undefined }
  }
  if (action.type === 'variant') {
    if (action.variant === state.spot.variant) return state
    const byVariant = { ...state.byVariant, [state.spot.variant]: state.spot }
    const spot = byVariant[action.variant] ?? defaultSpot(action.variant)
    return { spot, past: [], future: [], byVariant, lastAt: Date.now() }
  }

  const next = applyAction(state.spot, action)
  // Actions that change nothing (clearing an empty board) must not create undo steps.
  if (next === state.spot || JSON.stringify(next) === JSON.stringify(state.spot)) return state
  const coalesce = action.type === 'range' && action.typing ? `range:${action.player}` : undefined
  const now = Date.now()
  const merge = coalesce !== undefined && coalesce === state.lastCoalesce && now - state.lastAt < COALESCE_MS
  return {
    ...state,
    spot: next,
    past: merge ? state.past : [...state.past, state.spot].slice(-HISTORY_LIMIT),
    future: [],
    lastCoalesce: coalesce,
    lastAt: now,
  }
}

export function useSpot(initial: () => Spot) {
  const [state, dispatch] = useReducer(spotReducer, undefined, () => ({ spot: initial(), past: [], future: [], byVariant: {}, lastAt: 0 }))
  const act = useCallback((action: SpotAction) => dispatch(action), [])
  return { state, act }
}
