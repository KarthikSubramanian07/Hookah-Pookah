import { useState } from 'react'
import type { Card } from '../../engine/cards.ts'
import { RANK_CHARS, SUIT_CHARS, makeCard } from '../../engine/cards.ts'
import { cardName, slotId } from '../dom.ts'
import { PlayingCard } from './PlayingCard.tsx'

interface Props {
  slotKey: string
  group: string
  card: Card | null
  label: string
  minRank: number
  active?: boolean
  flash?: boolean
  size?: 'sm' | 'md'
  onOpen: (el: HTMLElement) => void
  onCard: (card: Card | null) => void
  /** Called after a card is typed so the parent can advance focus. */
  onTyped?: () => void
}

/**
 * A card position. Click or Enter opens the picker; typing a rank then a suit ("a" "h", "10" "d")
 * fills it directly; Backspace or Delete clears it.
 */
export function CardSlot({ slotKey, group, card, label, minRank, active, flash, size = 'md', onOpen, onCard, onTyped }: Props) {
  const [pendingRank, setPendingRank] = useState<number | null>(null)
  const [error, setError] = useState(false)

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const key = e.key
    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault()
      setPendingRank(null)
      onCard(null)
      return
    }
    if (key === 'Escape') {
      setPendingRank(null)
      return
    }
    const upper = key.toUpperCase()
    if (key === '1' || key === '0') {
      e.preventDefault()
      setPendingRank(8)
      return
    }
    const rank = RANK_CHARS.indexOf(upper)
    if (rank >= 0 && upper.length === 1) {
      e.preventDefault()
      if (rank < minRank) {
        setError(true)
        setTimeout(() => setError(false), 450)
        return
      }
      setPendingRank(rank)
      return
    }
    const suit = SUIT_CHARS.indexOf(key.toLowerCase())
    if (suit >= 0 && pendingRank !== null && key.length === 1) {
      e.preventDefault()
      onCard(makeCard(pendingRank, suit))
      setPendingRank(null)
      onTyped?.()
    }
  }

  return (
    <button
      type="button"
      id={slotId(slotKey)}
      className={`slot slot-${size}${card === null ? ' is-empty' : ''}${active ? ' is-active' : ''}${flash ? ' is-flash' : ''}${error ? ' is-error' : ''}`}
      data-slot={slotKey}
      data-slot-group={group}
      data-empty={card === null}
      aria-label={`${label}: ${card === null ? 'empty' : cardName(card)}. Type a rank and suit, or press Enter to pick.`}
      aria-haspopup="dialog"
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={onKeyDown}
      onBlur={() => setPendingRank(null)}
    >
      {card !== null ? (
        <PlayingCard card={card} size={size === 'sm' ? 'sm' : 'md'} />
      ) : (
        <span className="slot-empty" aria-hidden="true">
          {pendingRank !== null ? <span className="slot-pending mono">{RANK_CHARS[pendingRank] === 'T' ? '10' : RANK_CHARS[pendingRank]}</span> : '+'}
        </span>
      )}
    </button>
  )
}
