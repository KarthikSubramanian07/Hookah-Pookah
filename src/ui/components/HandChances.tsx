import { CATEGORY_NAMES, rulesFor } from '../../engine/evaluator.ts'
import type { ShortDeckRules, VariantId } from '../../engine/variants.ts'
import { VARIANTS } from '../../engine/variants.ts'
import type { PlayerSpot } from '../../state/spot.ts'
import { playerLabel } from '../../state/spot.ts'
import type { EquityUpdate } from '../../worker/pool.ts'
import { odds } from '../format.ts'

interface Props {
  variant: VariantId
  shortDeckRules: ShortDeckRules
  players: PlayerSpot[]
  result: EquityUpdate | undefined
  focus: number
  onFocus: (i: number) => void
}

/** Chance of finishing with each hand type by the river, strongest first under the active rules. */
export function HandChances({ variant, shortDeckRules, players, result, focus, onFocus }: Props) {
  const ranking = [...rulesFor(variant, shortDeckRules).ranking].reverse()
  const usable = result && result.players.length === players.length ? result : undefined
  const focusCats = usable?.players[focus]?.categories
  const max = focusCats ? Math.max(...focusCats) : 0

  return (
    <section className="chances" aria-labelledby="chances-title">
      <div className="section-head">
        <h2 id="chances-title" className="section-title">
          Hand chances
        </h2>
        <span className="section-note">
          {usable ? `by the river${VARIANTS[variant].mustUseTwo ? ', two hole cards plus three board cards' : ''}` : ''}
        </span>
      </div>
      <div className="chances-table" role="table" aria-label="Probability of each final hand">
        <div className="chances-row is-head" role="row">
          <span role="columnheader" className="chances-cat">
            Hand
          </span>
          {players.map((p, i) => (
            <span key={p.id} role="columnheader" className="chances-head-cell">
              <button
                type="button"
                className="chances-player"
                aria-pressed={focus === i}
                style={{ '--player': `var(--p${(i % 10) + 1})` } as React.CSSProperties}
                onClick={() => onFocus(i)}
                title={`Show bars for ${playerLabel(i)}`}
              >
                {i === 0 ? 'Hero' : `P${i + 1}`}
              </button>
            </span>
          ))}
        </div>
        {ranking.map((cat) => {
          const value = focusCats?.[cat] ?? 0
          return (
            <div className="chances-row" role="row" key={cat}>
              <span role="rowheader" className="chances-cat">
                <span className="chances-bar" style={{ '--w': max > 0 ? value / max : 0, '--player': `var(--p${(focus % 10) + 1})` } as React.CSSProperties} aria-hidden="true" />
                <span className="chances-cat-name">{CATEGORY_NAMES[cat]}</span>
              </span>
              {players.map((p, i) => {
                const v = usable?.players[i]?.categories[cat]
                return (
                  <span key={p.id} role="cell" className={`chances-cell mono${focus === i ? ' is-focus' : ''}`} title={v !== undefined ? `${(v * 100).toFixed(2)}%, odds ${odds(v)}` : undefined}>
                    {v === undefined ? '·' : v === 0 ? '0' : v < 0.0005 ? '<0.1' : (v * 100).toFixed(1)}
                  </span>
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
