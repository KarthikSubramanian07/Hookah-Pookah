import type { Card } from '../../engine/cards.ts'
import { RANK_CHARS, SUIT_NAMES, makeCard } from '../../engine/cards.ts'
import type { VariantId } from '../../engine/variants.ts'
import { VARIANTS } from '../../engine/variants.ts'
import type { PlayerSpot } from '../../state/spot.ts'
import { playerLabel } from '../../state/spot.ts'
import type { EquityState } from '../useEquity.ts'
import { cardName } from '../dom.ts'
import { SuitGlyph } from './PlayingCard.tsx'

interface Props {
  variant: VariantId
  boardLength: number
  players: PlayerSpot[]
  equity: EquityState
  used: Map<Card, string>
  focus: number
  onFocus: (i: number) => void
  onDeal: (card: Card) => void
}

const SUIT_ORDER = [3, 2, 1, 0]

/** Diverging colour for an equity change in percentage points: red worse, green better. */
function deltaColor(delta: number): string {
  const t = Math.max(-1, Math.min(1, delta / 40))
  if (Math.abs(t) < 0.02) return 'var(--surface-2)'
  const alpha = 0.18 + Math.abs(t) * 0.62
  return t > 0 ? `oklch(0.72 0.15 158 / ${alpha.toFixed(2)})` : `oklch(0.64 0.19 27 / ${alpha.toFixed(2)})`
}

export function NextCard({ variant, boardLength, players, equity, used, focus, onFocus, onDeal }: Props) {
  const street = boardLength === 3 ? 'turn' : boardLength === 4 ? 'river' : undefined
  const minRank = VARIANTS[variant].minRank
  const ranks: number[] = []
  for (let r = 12; r >= minRank; r--) ranks.push(r)
  const base = equity.result?.players[focus]?.equity
  const results = equity.nextCards

  let improve = 0
  let worsen = 0
  let favourite = 0
  let possible = 0
  for (const [, eq] of results) {
    if (!eq || base === undefined) continue
    possible++
    const d = eq[focus] - base
    if (d > 0.005) improve++
    if (d < -0.005) worsen++
    if (eq[focus] === Math.max(...eq) && eq[focus] > 0) favourite++
  }

  return (
    <section className="nextcard" aria-labelledby="nextcard-title">
      <div className="section-head">
        <h2 id="nextcard-title" className="section-title">
          {street ? `Every ${street} card` : 'Next card'}
        </h2>
        {street && players.length > 1 && (
          <div className="segmented" role="group" aria-label="Show equity for">
            {players.slice(0, 6).map((p, i) => (
              <button key={p.id} type="button" aria-pressed={focus === i} onClick={() => onFocus(i)}>
                {i === 0 ? 'Hero' : `P${i + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {!street ? (
        <p className="empty-note">Put a flop or a turn on the board to see how each possible next card changes {playerLabel(focus).toLowerCase() === 'hero' ? 'your' : `${playerLabel(focus)}'s`} equity.</p>
      ) : (
        <>
          <p className="nextcard-stats">
            {equity.nextStatus === 'running' && <span className="mono">{results.size}/{equity.nextTotal} cards</span>}
            {possible > 0 && (
              <>
                <span>
                  <strong className="is-better mono">{improve}</strong> improve
                </span>
                <span>
                  <strong className="is-worse mono">{worsen}</strong> hurt
                </span>
                {players.length > 1 && (
                  <span>
                    <strong className="mono">{favourite}</strong> of {possible} leave {focus === 0 ? 'you' : playerLabel(focus)} the favourite
                  </span>
                )}
              </>
            )}
          </p>
          <div className="nextcard-grid" role="grid" aria-label={`Equity after each ${street} card`} style={{ gridTemplateColumns: `auto repeat(${ranks.length}, 1fr)` }}>
            <span aria-hidden="true" />
            {ranks.map((r) => (
              <span key={r} className="nextcard-rank mono" aria-hidden="true">
                {RANK_CHARS[r]}
              </span>
            ))}
            {SUIT_ORDER.map((suit) => (
              <div key={suit} role="row" className="nextcard-row">
                <span className="nextcard-suit" role="rowheader" aria-label={SUIT_NAMES[suit]}>
                  <SuitGlyph suit={suit} />
                </span>
                {ranks.map((rank) => {
                  const card = makeCard(rank, suit)
                  const owner = used.get(card)
                  const eq = results.get(card)
                  const has = results.has(card)
                  const value = eq?.[focus]
                  const delta = value !== undefined && base !== undefined ? (value - base) * 100 : undefined
                  return (
                    <button
                      key={card}
                      type="button"
                      role="gridcell"
                      className={`nextcard-cell${owner ? ' is-used' : ''}${has && !eq ? ' is-blocked' : ''}`}
                      style={{ background: delta !== undefined ? deltaColor(delta) : undefined }}
                      disabled={!!owner || (has && !eq)}
                      onClick={() => onDeal(card)}
                      aria-label={
                        owner
                          ? `${cardName(card)} is on the table`
                          : value !== undefined
                            ? `${cardName(card)}: ${(value * 100).toFixed(1)}% equity, ${delta! >= 0 ? 'up' : 'down'} ${Math.abs(delta!).toFixed(1)} points. Deal it.`
                            : `${cardName(card)}: calculating`
                      }
                      title={value !== undefined ? `${cardName(card)}: ${(value * 100).toFixed(1)}% (${delta! >= 0 ? '+' : ''}${delta!.toFixed(1)})` : undefined}
                    >
                      {owner ? <span className="nextcard-owner">{owner === 'Board' ? 'B' : owner === 'Dead' ? 'D' : owner}</span> : value !== undefined ? <span className="mono">{Math.round(value * 100)}</span> : <span className="nextcard-wait" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <p className="nextcard-legend">
            Numbers are {focus === 0 ? "hero's" : `${playerLabel(focus)}'s`} equity after that card. Green improves, red hurts. Click a card to deal it.
          </p>
        </>
      )}
    </section>
  )
}
