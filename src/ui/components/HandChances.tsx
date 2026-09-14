import { CATEGORY_NAMES, rulesFor } from '../../engine/evaluator.ts'
import type { ShortDeckRules, VariantId } from '../../engine/variants.ts'
import { VARIANTS } from '../../engine/variants.ts'
import type { PlayerSpot } from '../../state/spot.ts'
import { playerLabel, playerShortLabel } from '../../state/spot.ts'
import type { EquityUpdate } from '../../worker/pool.ts'
import { odds } from '../format.ts'

interface Props {
  variant: VariantId
  shortDeckRules: ShortDeckRules
  players: PlayerSpot[]
  result: EquityUpdate | undefined
  advanced: boolean
  focus: number
  onFocus: (i: number) => void
}

const fmt = (v: number | undefined) => (v === undefined ? '·' : v === 0 ? '0' : v < 0.0005 ? '<0.1' : (v * 100).toFixed(1))

/** Chance of finishing with each hand type once all board cards are out, strongest first under the active rules. */
export function HandChances({ variant, shortDeckRules, players, result, advanced, focus, onFocus }: Props) {
  const ranking = [...rulesFor(variant, shortDeckRules).ranking].reverse()
  const usable = result && result.players.length === players.length ? result : undefined
  const who = advanced ? focus : 0
  const cats = usable?.players[who]?.categories
  const max = cats ? Math.max(...cats) : 0
  const note = VARIANTS[variant].mustUseTwo ? 'Omaha hands use exactly two of your cards and three from the board.' : undefined

  if (!advanced) {
    const rows = ranking.filter((cat) => (cats?.[cat] ?? 1) > 0)
    return (
      <section className="chances" aria-labelledby="chances-title">
        <div className="section-head">
          <h2 id="chances-title" className="section-title">
            What you'll finish with
          </h2>
          <span className="section-note">once all five board cards are out</span>
        </div>
        {cats ? (
          <ul className="chance-list">
            {rows.map((cat) => (
              <li key={cat} className="chance-row" title={`${((cats[cat] ?? 0) * 100).toFixed(2)}%, odds ${odds(cats[cat])}`}>
                <span className="chance-name">{CATEGORY_NAMES[cat]}</span>
                <span className="chance-track" aria-hidden="true">
                  <span className="chance-fill" style={{ width: `${max > 0 ? (cats[cat] / max) * 100 : 0}%` }} />
                </span>
                <span className="chance-value mono">{fmt(cats[cat])}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">Appears once your odds are ready.</p>
        )}
        {note && <p className="section-foot">{note}</p>}
      </section>
    )
  }

  return (
    <section className="chances" aria-labelledby="chances-title">
      <div className="section-head">
        <h2 id="chances-title" className="section-title">
          Final hand chances
        </h2>
        <span className="section-note">by the river, in %. Pick a column to highlight it.</span>
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
                title={`Highlight ${playerLabel(i)}`}
              >
                {playerShortLabel(i)}
              </button>
            </span>
          ))}
        </div>
        {ranking.map((cat) => (
          <div className="chances-row" role="row" key={cat}>
            <span role="rowheader" className="chances-cat">
              <span className="chances-bar" style={{ '--w': max > 0 ? (cats?.[cat] ?? 0) / max : 0, '--player': `var(--p${(focus % 10) + 1})` } as React.CSSProperties} aria-hidden="true" />
              <span className="chances-cat-name">{CATEGORY_NAMES[cat]}</span>
            </span>
            {players.map((p, i) => {
              const v = usable?.players[i]?.categories[cat]
              return (
                <span key={p.id} role="cell" className={`chances-cell mono${focus === i ? ' is-focus' : ''}`} title={v !== undefined ? `${(v * 100).toFixed(2)}%, odds ${odds(v)}` : undefined}>
                  {fmt(v)}
                </span>
              )
            })}
          </div>
        ))}
      </div>
      {note && <p className="section-foot">{note}</p>}
    </section>
  )
}
