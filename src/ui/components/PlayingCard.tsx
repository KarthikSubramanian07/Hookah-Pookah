import type { Card } from '../../engine/cards.ts'
import { RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from '../../engine/cards.ts'
import { cardName } from '../dom.ts'

const SUIT_KEYS = ['c', 'd', 'h', 's'] as const

interface Props {
  card: Card
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** When true, the parent already names the control; hide this face from the accessibility tree. */
  decorative?: boolean
}

/** A card face drawn in CSS: rank in the corner, a large suit pip, four-colour suits. */
export function PlayingCard({ card, size = 'md', className = '', decorative = false }: Props) {
  const rank = RANK_CHARS[rankOf(card)]
  const suit = suitOf(card)
  return (
    <span
      className={`pcard pcard-${size} suit-${SUIT_KEYS[suit]} ${className}`}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : cardName(card)}
      aria-hidden={decorative ? true : undefined}
    >
      <span className="pcard-rank" aria-hidden="true">
        {rank === 'T' ? '10' : rank}
      </span>
      <span className="pcard-suit" aria-hidden="true">
        {SUIT_SYMBOLS[suit]}
      </span>
    </span>
  )
}

export function SuitGlyph({ suit }: { suit: number }) {
  return (
    <span className={`suit-glyph suit-${SUIT_KEYS[suit]}`} aria-hidden="true">
      {SUIT_SYMBOLS[suit]}
    </span>
  )
}
