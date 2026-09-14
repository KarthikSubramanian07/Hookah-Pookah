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
import { decimalsFor, pct } from '../format.ts'
import type { SlotRef } from '../useSpot.ts'
import { focusNextSlot } from '../dom.ts'
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
  problem: string | undefined
  issues: RangeIssue[] | undefined
  activeSlot: string | undefined
  flashSlot: string | undefined
  onOpenSlot: (ref: SlotRef, key: string, el: HTMLElement, label: string) => void
  onCard: (ref: SlotRef, card: Card | null) => void
  onMode: (mode: 'cards' | 'range') => void
  onRange: (text: string) => void
  onRanking: (ranking: RankingId) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
  onClear: () => void
}

export function PlayerRow(props: Props) {
  const { index, count, player, variant, result, stale } = props
  const info = VARIANTS[variant]
  const [editorOpen, setEditorOpen] = useState(true)
  const label = playerLabel(index)
  const group = `p${player.id}`
  const r = result?.players[index]
  const known = player.cards.filter((c): c is Card => c !== null)
  const handValue =
    player.mode === 'cards' && known.length === info.holeCount ? currentHandValue(variant, known, props.board, props.shortDeckRules) : undefined
  const randomCount = player.mode === 'cards' ? info.holeCount - known.length : 0

  return (
    <li className={`player${index === 0 ? ' is-hero' : ''}`} style={{ '--player': `var(--p${(index % 10) + 1})` } as React.CSSProperties}>
      <div className="player-head">
        <span className="player-dot" aria-hidden="true" />
        <h3 className="player-name">{label}</h3>
        {info.supportsRanges && (
          <div className="segmented" role="group" aria-label={`${label} input`}>
            <button type="button" aria-pressed={player.mode === 'cards'} onClick={() => props.onMode('cards')}>
              Cards
            </button>
            <button type="button" aria-pressed={player.mode === 'range'} onClick={() => props.onMode('range')}>
              Range
            </button>
          </div>
        )}
        <div className="player-actions">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => props.onMove(-1)}>
            ↑
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => props.onMove(1)}>
            ↓
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClear}>
            Clear
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${label}`} disabled={count <= 1} onClick={props.onRemove}>
            ✕
          </button>
        </div>
      </div>

      <div className="player-body">
        {player.mode === 'cards' ? (
          <div className="player-cards">
            <div className="slots" role="group" aria-label={`${label} hole cards`}>
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
            <p className="player-note">
              {handValue !== undefined ? (
                <span className="player-made">{describeValue(handValue)}</span>
              ) : randomCount === info.holeCount ? (
                <span>Random hand</span>
              ) : randomCount > 0 ? (
                <span>
                  {randomCount} random card{randomCount > 1 ? 's' : ''}
                </span>
              ) : (
                <span>&nbsp;</span>
              )}
            </p>
          </div>
        ) : (
          <div className="player-range-summary">
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={editorOpen} onClick={() => setEditorOpen((v) => !v)}>
              {editorOpen ? 'Hide grid' : 'Edit range'}
            </button>
            <span className="mono player-range-text">{player.range || 'empty range'}</span>
          </div>
        )}

        <div className={`player-equity${stale ? ' is-stale' : ''}`} aria-live="polite">
          {r ? (
            <>
              <span className="player-equity-value mono">{pct(r.equity, decimalsFor(result!, r.stdErr))}</span>
              <span className="player-equity-sub mono">
                win {pct(r.win, 1)} · tie {pct(r.tie, 1)}
              </span>
              <span className="player-bar" aria-hidden="true">
                <span className="player-bar-win" style={{ width: `${r.win * 100}%` }} />
                <span className="player-bar-tie" style={{ width: `${(r.equity - r.win) * 100}%` }} />
              </span>
            </>
          ) : props.problem ? (
            <span className="player-problem">{props.problem}</span>
          ) : (
            <span className="player-equity-value mono is-placeholder">…</span>
          )}
        </div>
      </div>

      {player.mode === 'range' && editorOpen && (
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
