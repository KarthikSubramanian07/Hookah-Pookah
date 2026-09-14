import type { Card } from '../../engine/cards.ts'
import { VARIANTS, type VariantId } from '../../engine/variants.ts'
import { MAX_DEAD } from '../../state/spot.ts'
import type { SlotRef } from '../useSpot.ts'
import { focusNextSlot } from '../dom.ts'
import { CardSlot } from './CardSlot.tsx'

interface Props {
  variant: VariantId
  board: (Card | null)[]
  dead: Card[]
  activeSlot: string | undefined
  flashSlot: string | undefined
  problem: string | undefined
  onOpenSlot: (ref: SlotRef, key: string, el: HTMLElement, label: string) => void
  onCard: (ref: SlotRef, card: Card | null) => void
  onDeal: (upTo: 3 | 4 | 5) => void
  onClearBoard: () => void
  onClearDead: () => void
}

const STREETS = ['Flop', 'Flop', 'Flop', 'Turn', 'River']

export function BoardPanel(props: Props) {
  const { board, dead, variant } = props
  const minRank = VARIANTS[variant].minRank
  const filled = board.filter((c) => c !== null).length
  const deadSlots = [...dead, null].slice(0, MAX_DEAD)

  const slot = (ref: SlotRef, key: string, group: string, card: Card | null, label: string, size: 'sm' | 'md' = 'md') => (
    <CardSlot
      key={key}
      slotKey={key}
      group={group}
      card={card}
      label={label}
      minRank={minRank}
      size={size}
      active={props.activeSlot === key}
      flash={props.flashSlot === key}
      onOpen={(el) => props.onOpenSlot(ref, key, el, label)}
      onCard={(c) => props.onCard(ref, c)}
      onTyped={() => focusNextSlot(key, group)}
    />
  )

  return (
    <section className="board" aria-labelledby="board-title">
      <div className="section-head">
        <h2 id="board-title" className="section-title">
          Board
        </h2>
        <div className="section-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => props.onDeal(3)} disabled={filled >= 3}>
            Deal flop
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => props.onDeal(filled >= 3 ? ((filled + 1) as 4 | 5) : 5)} disabled={filled >= 5}>
            {filled >= 4 ? 'Deal river' : filled === 3 ? 'Deal turn' : 'Deal all'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClearBoard} disabled={filled === 0}>
            Clear
          </button>
        </div>
      </div>
      <div className="board-streets">
        <div className="street" role="group" aria-label="Flop">
          {[0, 1, 2].map((i) => slot({ kind: 'board', slot: i }, `b-${i}`, 'board', board[i], `${STREETS[i]} card ${i + 1}`))}
        </div>
        <div className="street" role="group" aria-label="Turn">
          {slot({ kind: 'board', slot: 3 }, 'b-3', 'board', board[3], 'Turn')}
        </div>
        <div className="street" role="group" aria-label="River">
          {slot({ kind: 'board', slot: 4 }, 'b-4', 'board', board[4], 'River')}
        </div>
      </div>
      {props.problem && <p className="inline-problem">{props.problem}</p>}

      <div className="dead">
        <div className="section-head">
          <h3 className="label">Dead cards</h3>
          {dead.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClearDead}>
              Clear
            </button>
          )}
        </div>
        <div className="dead-slots" role="group" aria-label="Dead cards">
          {deadSlots.map((card, i) => slot({ kind: 'dead', slot: i }, `d-${i}`, 'dead', card, `Dead card ${i + 1}`, 'sm'))}
        </div>
      </div>
    </section>
  )
}
