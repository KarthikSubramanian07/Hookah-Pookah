import type { Card } from './cards.ts'
import { rankOf } from './cards.ts'

export type VariantId = 'holdem' | 'shortdeck' | 'omaha4' | 'omaha5'

/**
 * Short deck has two rule sets in the wild:
 *  - "triton": three of a kind beats a straight (Triton Poker, GGPoker, most modern rooms)
 *  - "classic": straight beats three of a kind (early Asian home games, some iPoker rooms)
 * Both agree that a flush beats a full house and that A-6-7-8-9 is the lowest straight.
 */
export type ShortDeckRules = 'triton' | 'classic'

export interface VariantInfo {
  id: VariantId
  name: string
  shortName: string
  holeCount: number
  /** Omaha rule: exactly two hole cards and three board cards. */
  mustUseTwo: boolean
  /** Lowest rank index present in the deck (0 for 52 cards, 4 for short deck). */
  minRank: number
  deckSize: number
  supportsRanges: boolean
  maxPlayers: number
}

export const VARIANTS: Record<VariantId, VariantInfo> = {
  holdem: {
    id: 'holdem',
    name: "Texas Hold'em",
    shortName: "Hold'em",
    holeCount: 2,
    mustUseTwo: false,
    minRank: 0,
    deckSize: 52,
    supportsRanges: true,
    maxPlayers: 10,
  },
  shortdeck: {
    id: 'shortdeck',
    name: "Short Deck Hold'em",
    shortName: 'Short Deck',
    holeCount: 2,
    mustUseTwo: false,
    minRank: 4,
    deckSize: 36,
    supportsRanges: true,
    maxPlayers: 10,
  },
  omaha4: {
    id: 'omaha4',
    name: 'Pot Limit Omaha',
    shortName: 'PLO4',
    holeCount: 4,
    mustUseTwo: true,
    minRank: 0,
    deckSize: 52,
    supportsRanges: false,
    maxPlayers: 10,
  },
  omaha5: {
    id: 'omaha5',
    name: '5 Card Omaha',
    shortName: 'PLO5',
    holeCount: 5,
    mustUseTwo: true,
    minRank: 0,
    deckSize: 52,
    supportsRanges: false,
    maxPlayers: 9,
  },
}

export const VARIANT_IDS = Object.keys(VARIANTS) as VariantId[]

export const BOARD_SIZE = 5

export const isVariantId = (v: unknown): v is VariantId => typeof v === 'string' && v in VARIANTS

/** Every card that exists in the variant's deck, ascending. */
export function deckFor(variant: VariantId): Card[] {
  const { minRank } = VARIANTS[variant]
  const deck: Card[] = []
  for (let c = minRank * 4; c < 52; c++) deck.push(c)
  return deck
}

export const cardInDeck = (variant: VariantId, card: Card): boolean => rankOf(card) >= VARIANTS[variant].minRank
