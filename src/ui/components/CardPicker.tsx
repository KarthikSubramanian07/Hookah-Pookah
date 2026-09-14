import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Card } from '../../engine/cards.ts'
import { RANK_CHARS, SUIT_CHARS, SUIT_NAMES, makeCard } from '../../engine/cards.ts'
import { cardName } from '../dom.ts'
import { PlayingCard, SuitGlyph } from './PlayingCard.tsx'

interface Props {
  anchor: HTMLElement
  title: string
  current: Card | null
  minRank: number
  /** Owner label for every card already on the table. */
  used: Map<Card, string>
  onPick: (card: Card) => void
  onClear: () => void
  onRandom: () => void
  onClose: () => void
}

const SUIT_ORDER = [3, 2, 1, 0] // spades, hearts, diamonds, clubs

/** Deck grid popover. Arrow keys move, typing a rank and suit picks, Escape closes. */
export function CardPicker({ anchor, title, current, minRank, used, onPick, onClear, onRandom, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'below' | 'above' }>({ top: 0, left: 0, placement: 'below' })
  const [pendingRank, setPendingRank] = useState<number | null>(null)
  const ranks: number[] = []
  for (let r = 12; r >= minRank; r--) ranks.push(r)

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const el = ref.current
      const w = el?.offsetWidth ?? 520
      const h = el?.offsetHeight ?? 260
      const margin = 8
      const vw = window.innerWidth
      const vh = window.innerHeight
      let left = a.left + a.width / 2 - w / 2
      left = Math.max(margin, Math.min(left, vw - w - margin))
      const below = a.bottom + margin
      const placement = below + h > vh - margin && a.top - h - margin > margin ? 'above' : 'below'
      const top = placement === 'below' ? Math.min(below, Math.max(margin, vh - h - margin)) : a.top - h - margin
      setPos({ top, left, placement })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  useEffect(() => {
    const target = ref.current?.querySelector<HTMLButtonElement>('[data-current="true"]') ?? ref.current?.querySelector<HTMLButtonElement>('.picker-card:not([data-used="true"])')
    target?.focus({ preventScroll: true })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [anchor, onClose])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      anchor.focus()
      return
    }
    const active = document.activeElement as HTMLElement | null
    const row = Number(active?.dataset.row)
    const col = Number(active?.dataset.col)
    const move = (dr: number, dc: number) => {
      if (Number.isNaN(row)) return
      const r = (row + dr + 4) % 4
      const c = (col + dc + ranks.length) % ranks.length
      ref.current?.querySelector<HTMLButtonElement>(`[data-row="${r}"][data-col="${c}"]`)?.focus()
    }
    if (e.key === 'ArrowRight') return e.preventDefault(), move(0, 1)
    if (e.key === 'ArrowLeft') return e.preventDefault(), move(0, -1)
    if (e.key === 'ArrowDown') return e.preventDefault(), move(1, 0)
    if (e.key === 'ArrowUp') return e.preventDefault(), move(-1, 0)
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      onClear()
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const isTen = e.key === '1' || e.key === '0'
    const rank = isTen ? 8 : e.key.length === 1 ? RANK_CHARS.indexOf(e.key.toUpperCase()) : -1
    if (rank >= 0) {
      e.preventDefault()
      if (rank >= minRank) setPendingRank(rank)
      return
    }
    const suit = SUIT_CHARS.indexOf(e.key.toLowerCase())
    if (suit >= 0 && pendingRank !== null && e.key.length === 1) {
      e.preventDefault()
      onPick(makeCard(pendingRank, suit))
      setPendingRank(null)
    }
  }

  return (
    <div
      ref={ref}
      className={`picker picker-${pos.placement}`}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={`Pick a card for ${title}`}
      onKeyDown={onKeyDown}
    >
      <div className="picker-head">
        <span className="picker-title">{title}</span>
        <span className="picker-hint">
          {pendingRank !== null ? (
            <>
              <span className="mono">{RANK_CHARS[pendingRank]}</span> then a suit: c d h s
            </>
          ) : (
            <>Type <kbd>a</kbd> <kbd>h</kbd> or use arrows</>
          )}
        </span>
      </div>
      <div className="picker-grid" role="grid" style={{ gridTemplateColumns: `auto repeat(${ranks.length}, 1fr)` }}>
        {SUIT_ORDER.map((suit, row) => (
          <div className="picker-row" role="row" key={suit}>
            <span className="picker-suit" role="rowheader" aria-label={SUIT_NAMES[suit]}>
              <SuitGlyph suit={suit} />
            </span>
            {ranks.map((rank, col) => {
              const card = makeCard(rank, suit)
              const owner = used.get(card)
              const isCurrent = card === current
              return (
                <button
                  key={card}
                  type="button"
                  role="gridcell"
                  className="picker-card"
                  data-row={row}
                  data-col={col}
                  data-used={owner !== undefined && !isCurrent}
                  data-current={isCurrent}
                  tabIndex={-1}
                  aria-label={`${cardName(card)}${owner && !isCurrent ? `, in use by ${owner}, pick to move it here` : ''}`}
                  onClick={() => onPick(card)}
                >
                  <PlayingCard card={card} size="sm" />
                  {owner !== undefined && !isCurrent && <span className="picker-owner">{owner}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="picker-foot">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
          Clear
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRandom}>
          Random card
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
