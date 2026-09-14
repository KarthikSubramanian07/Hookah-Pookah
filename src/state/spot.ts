/**
 * A "spot" is everything the user has entered: variant, players, board and dead cards.
 * It is plain serialisable data; `toRequest` turns it into an engine request.
 */

import type { Card } from '../engine/cards.ts'
import { formatCard, parseCards } from '../engine/cards.ts'
import type { EquityRequest, PlayerInput } from '../engine/equity.ts'
import type { RankingId } from '../engine/preflopRanking.ts'
import { comboFromKey, parseRange, type RangeIssue } from '../engine/ranges.ts'
import type { ShortDeckRules, VariantId } from '../engine/variants.ts'
import { BOARD_SIZE, VARIANTS } from '../engine/variants.ts'

export type PlayerMode = 'cards' | 'range'

export interface PlayerSpot {
  /** Stable id for React keys and colour assignment. */
  id: number
  mode: PlayerMode
  /** Hole card slots; null = unknown (dealt at random). Length = variant hole count. */
  cards: (Card | null)[]
  /** Range text, used when mode = 'range'. */
  range: string
}

export interface Spot {
  variant: VariantId
  shortDeckRules: ShortDeckRules
  ranking: RankingId
  players: PlayerSpot[]
  board: (Card | null)[]
  dead: Card[]
}

export const MAX_DEAD = 12

let nextId = 1
export const newPlayerId = (): number => nextId++
/** Keeps generated ids ahead of ids restored from URLs or storage. */
export const reserveIds = (ids: number[]): void => {
  for (const id of ids) if (id >= nextId) nextId = id + 1
}

export function emptyPlayer(variant: VariantId, mode: PlayerMode = 'cards'): PlayerSpot {
  return { id: newPlayerId(), mode, cards: Array(VARIANTS[variant].holeCount).fill(null), range: '' }
}

export function defaultSpot(variant: VariantId = 'holdem'): Spot {
  const hc = VARIANTS[variant].holeCount
  const hero = emptyPlayer(variant)
  const villain = emptyPlayer(variant)
  if (variant === 'holdem') {
    hero.cards = parseCards('AhKh')
    villain.cards = parseCards('QsQd')
  } else if (variant === 'shortdeck') {
    hero.cards = parseCards('AsKs')
    villain.cards = parseCards('QhQd')
  } else if (variant === 'omaha4') {
    hero.cards = parseCards('AsAhKsKh')
    villain.cards = parseCards('JdTd9c8c')
  } else {
    hero.cards = parseCards('AsAhKsKhQd')
    villain.cards = parseCards('JcTc9d8d7h')
  }
  hero.cards = [...hero.cards, ...Array(hc - hero.cards.length).fill(null)].slice(0, hc)
  villain.cards = [...villain.cards, ...Array(hc - villain.cards.length).fill(null)].slice(0, hc)
  return {
    variant,
    shortDeckRules: 'triton',
    ranking: 'vs3',
    players: [hero, villain],
    board: Array(BOARD_SIZE).fill(null),
    dead: [],
  }
}

/** Every card currently placed anywhere in the spot, mapped to a human label of its owner. */
export function usedCards(spot: Spot): Map<Card, string> {
  const used = new Map<Card, string>()
  spot.players.forEach((p, i) => {
    if (p.mode === 'cards') p.cards.forEach((c) => c !== null && used.set(c, i === 0 ? 'You' : `Opp ${i}`))
  })
  spot.board.forEach((c) => c !== null && used.set(c, 'Board'))
  spot.dead.forEach((c) => used.set(c, 'Dead'))
  return used
}

export interface SpotProblem {
  /** Player index, or 'board' / 'dead' / 'spot'. */
  where: number | 'board' | 'dead' | 'spot'
  message: string
}

export interface CompiledSpot {
  request: EquityRequest | undefined
  problems: SpotProblem[]
  rangeIssues: Map<number, RangeIssue[]>
  /** Combo count per range player (after parsing, before card removal). */
  rangeSizes: Map<number, number>
}

/** Board cards must be filled left to right: a turn without a flop is not a real street. */
export function compactBoard(board: (Card | null)[]): Card[] {
  return board.filter((c): c is Card => c !== null)
}

export function compileSpot(spot: Spot): CompiledSpot {
  const problems: SpotProblem[] = []
  const rangeIssues = new Map<number, RangeIssue[]>()
  const rangeSizes = new Map<number, number>()
  const info = VARIANTS[spot.variant]
  const players: PlayerInput[] = spot.players.map((p, i) => {
    if (p.mode === 'range' && info.supportsRanges) {
      const text = p.range.trim()
      if (!text) {
        problems.push({ where: i, message: 'Range is empty' })
        return {}
      }
      const parsed = parseRange(text, spot.variant, spot.ranking)
      if (parsed.issues.length) rangeIssues.set(i, parsed.issues)
      rangeSizes.set(i, parsed.combos.size)
      if (!parsed.combos.size) {
        problems.push({ where: i, message: 'Range has no valid hands' })
        return {}
      }
      return { range: [...parsed.combos].map(([key, weight]) => ({ cards: comboFromKey(key), weight })) }
    }
    return { cards: p.cards.filter((c): c is Card => c !== null) }
  })
  const board = compactBoard(spot.board)
  const firstGap = spot.board.indexOf(null)
  if (firstGap >= 0 && spot.board.slice(firstGap).some((c) => c !== null)) {
    problems.push({ where: 'board', message: 'Fill board cards from left to right' })
  }
  const request: EquityRequest | undefined = problems.length
    ? undefined
    : { variant: spot.variant, shortDeckRules: spot.shortDeckRules, players, board, dead: [...spot.dead] }
  return { request, problems, rangeIssues, rangeSizes }
}

export const playerLabel = (i: number): string => (i === 0 ? 'You' : `Opponent ${i}`)

export const playerShortLabel = (i: number): string => (i === 0 ? 'You' : `Opp ${i}`)

/** Spots that use features only shown in advanced mode. */
export const needsAdvanced = (spot: Spot): boolean => spot.players.some((p) => p.mode === 'range') || spot.dead.length > 0

export const describeCards = (cards: (Card | null)[]): string => cards.map((c) => (c === null ? '?' : formatCard(c))).join('')
