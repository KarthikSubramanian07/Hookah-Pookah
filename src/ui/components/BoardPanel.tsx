import type { Card } from '../../engine/cards.ts'
import { VARIANTS, type VariantId } from '../../engine/variants.ts'
import { MAX_DEAD } from '../../state/spot.ts'
import type { SlotRef } from '../useSpot.ts'
import { focusNextSlot } from '../dom.ts'
import { CardSlot } from './CardSlot.tsx'

interface Props {
  step: number
  advanced: boolean
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
        <h2 id="board-title" className="section-title step-title">
          <span className="step-number mono" aria-hidden="true">
            {props.step}
          </span>
          Board <span className="step-optional">optional</span>
        </h2>
        <div className="section-actions">
          {filled < 3 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => props.onDeal(3)}>
              Random flop
            </button>
          )}
          {filled >= 3 && filled < 5 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => props.onDeal((filled + 1) as 4 | 5)}>
              {filled === 3 ? 'Random turn' : 'Random river'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClearBoard} disabled={filled === 0}>
            Clear
          </button>
        </div>
      </div>
      <div className="board-streets">
        <figure className="street-group">
          <div className="street" role="group" aria-label="Flop">
            {[0, 1, 2].map((i) => slot({ kind: 'board', slot: i }, `b-${i}`, 'board', board[i], `${STREETS[i]} card ${i + 1}`))}
          </div>
          <figcaption className="street-label">Flop</figcaption>
        </figure>
        <figure className="street-group">
          <div className="street" role="group" aria-label="Turn">
            {slot({ kind: 'board', slot: 3 }, 'b-3', 'board', board[3], 'Turn')}
          </div>
          <figcaption className="street-label">Turn</figcaption>
        </figure>
        <figure className="street-group">
          <div className="street" role="group" aria-label="River">
            {slot({ kind: 'board', slot: 4 }, 'b-4', 'board', board[4], 'River')}
          </div>
          <figcaption className="street-label">River</figcaption>
        </figure>
      </div>
      {filled === 0 && <p className="section-lede">Leave it empty for odds before the flop, or add the flop, turn and river as they come.</p>}
      {props.problem && <p className="inline-problem">{props.problem}</p>}

      {!props.advanced && dead.length > 0 && <p className="section-foot">{dead.length} dead card{dead.length > 1 ? 's' : ''} removed from the deck (edit in advanced).</p>}
      {props.advanced && (
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
        <p className="section-foot">Cards you know are out of play, like a burned or folded card.</p>
      </div>
      )}
    </section>
  )
}
