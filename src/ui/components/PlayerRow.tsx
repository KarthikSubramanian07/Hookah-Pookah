import { useState } from 'react'
import type { Card } from '../../engine/cards.ts'
import { currentHandValue } from '../../engine/equity.ts'
import { describeValue } from '../../engine/evaluator.ts'
import type { RankingId } from '../../engine/preflopRanking.ts'
import type { RangeIssue } from '../../engine/ranges.ts'
import type { ShortDeckRules, VariantId } from '../../engine/variants.ts'
import { VARIANTS } from '../../engine/variants.ts'
import type { PlayerSpot } from '../../state/spot.ts'
import { playerLabel } from '../../state/spot.ts'
import type { EquityUpdate } from '../../worker/pool.ts'
import { focusNextSlot } from '../dom.ts'
import { decimalsFor, pct } from '../format.ts'
import type { SlotRef } from '../useSpot.ts'
import { CardSlot } from './CardSlot.tsx'
import { RangeEditor } from './RangeEditor.tsx'

interface Props {
  index: number
  count: number
  player: PlayerSpot
  variant: VariantId
  shortDeckRules: ShortDeckRules
  ranking: RankingId
  board: Card[]
  blocked: Set<Card>
  result: EquityUpdate | undefined
  stale: boolean
  advanced: boolean
  problem: string | undefined
  issues: RangeIssue[] | undefined
  activeSlot: string | undefined
  flashSlot: string | undefined
  onOpenSlot: (ref: SlotRef, key: string, el: HTMLElement, label: string) => void
  onCard: (ref: SlotRef, card: Card | null) => void
  onMode: (mode: 'cards' | 'range') => void
  onRange: (text: string, typing?: boolean) => void
  onRanking: (ranking: RankingId) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
  onClear: () => void
  onAdvanced: () => void
}

export function PlayerRow(props: Props) {
  const { index, count, player, variant, result, stale, advanced } = props
  const info = VARIANTS[variant]
  const [editorOpen, setEditorOpen] = useState(false)
  const label = playerLabel(index)
  const isYou = index === 0
  const group = `p${player.id}`
  const r = result?.players[index]
  const known = player.cards.filter((c): c is Card => c !== null)
  const handValue =
    player.mode === 'cards' && known.length === info.holeCount ? currentHandValue(variant, known, props.board, props.shortDeckRules) : undefined
  const randomCount = player.mode === 'cards' ? info.holeCount - known.length : 0

  let note: React.ReactNode
  if (handValue !== undefined) note = <span className="player-made">{describeValue(handValue)}</span>
  else if (randomCount === info.holeCount) note = isYou ? 'Tap a card to pick your hand' : 'Unknown hand, dealt at random'
  else if (randomCount > 0) note = `${randomCount} unknown card${randomCount > 1 ? 's' : ''}, dealt at random`

  return (
    <li className={`player${isYou ? ' is-hero' : ''}`} style={{ '--player': `var(--p${(index % 10) + 1})` } as React.CSSProperties}>
      <div className="player-head">
        <span className="player-dot" aria-hidden="true" />
        <h3 className="player-name">{label}</h3>
        {advanced && info.supportsRanges && (
          <div className="segmented" role="group" aria-label={`${label} input`}>
            <button type="button" aria-pressed={player.mode === 'cards'} onClick={() => props.onMode('cards')}>
              Cards
            </button>
            <button
              type="button"
              aria-pressed={player.mode === 'range'}
              onClick={() => {
                props.onMode('range')
                setEditorOpen(true)
              }}
            >
              Range
            </button>
          </div>
        )}
        <div className="player-actions">
          {advanced && (
            <>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => props.onMove(-1)}>
                ↑
              </button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => props.onMove(1)}>
                ↓
              </button>
            </>
          )}
          {(known.length > 0 || player.mode === 'range') && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClear}>
              Clear
            </button>
          )}
          {!isYou && (
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${label}`} disabled={count <= 1} onClick={props.onRemove}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="player-body">
        {player.mode === 'cards' ? (
          <div className="player-cards">
            <div className="slots" role="group" aria-label={`${label}: hole cards`}>
              {player.cards.map((card, slot) => {
                const key = `${group}-${slot}`
                const ref: SlotRef = { kind: 'player', player: index, slot }
                return (
                  <CardSlot
                    key={slot}
                    slotKey={key}
                    group={group}
                    card={card}
                    label={`${label} card ${slot + 1}`}
                    minRank={info.minRank}
                    active={props.activeSlot === key}
                    flash={props.flashSlot === key}
                    onOpen={(el) => props.onOpenSlot(ref, key, el, `${label}, card ${slot + 1}`)}
                    onCard={(c) => props.onCard(ref, c)}
                    onTyped={() => focusNextSlot(key)}
                  />
                )
              })}
            </div>
            <p className="player-note">{note ?? ' '}</p>
          </div>
        ) : (
          <div className="player-range-summary">
            <span className="player-range-label">Range</span>
            <span className="mono player-range-text">{player.range || 'empty'}</span>
            {advanced ? (
              <button type="button" className="btn btn-sm" aria-expanded={editorOpen} onClick={() => setEditorOpen((v) => !v)}>
                {editorOpen ? 'Done' : 'Edit range'}
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-ghost" onClick={props.onAdvanced}>
                Edit in advanced
              </button>
            )}
          </div>
        )}

        <div className={`player-equity${stale ? ' is-stale' : ''}`}>
          {r ? (
            <span className="player-equity-value mono" aria-label={`${label}: ${pct(r.equity, 1)} chance to win`}>
              {pct(r.equity, Math.min(decimalsFor(result!, r.stdErr), 1))}
            </span>
          ) : props.problem ? (
            <span className="player-problem">{props.problem}</span>
          ) : null}
        </div>
      </div>

      {player.mode === 'range' && advanced && editorOpen && (
        <RangeEditor
          variant={variant}
          text={player.range}
          ranking={props.ranking}
          issues={props.issues}
          blocked={props.blocked}
          breakdown={result?.ranges.find((b) => b.player === index)?.combos}
          playerIndex={index}
          onText={props.onRange}
          onRanking={props.onRanking}
        />
      )}
    </li>
  )
}
