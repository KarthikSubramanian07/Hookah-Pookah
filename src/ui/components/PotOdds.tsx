import { useId, useState } from 'react'
import type { EquityUpdate } from '../../worker/pool.ts'
import { Z95, pct } from '../format.ts'

interface Props {
  result: EquityUpdate | undefined
  heroLabel: string
}

/**
 * Break-even check for a call: required equity = call / (pot + call), where pot already includes the bet.
 * Verdicts respect the Monte Carlo interval so a coin flip inside the error bar reads as "too close".
 */
export function PotOdds({ result, heroLabel }: Props) {
  const [pot, setPot] = useState('100')
  const [call, setCall] = useState('50')
  const id = useId()
  const potN = Number(pot)
  const callN = Number(call)
  const valid = Number.isFinite(potN) && Number.isFinite(callN) && potN >= 0 && callN > 0
  const required = valid ? callN / (potN + callN) : undefined
  const hero = result?.players[0]
  const margin = hero && result?.method === 'montecarlo' ? Z95 * hero.stdErr : 0
  const ev = valid && hero ? hero.equity * (potN + callN) - callN : undefined

  let verdict: { text: string; tone: 'better' | 'worse' | 'even' } | undefined
  if (required !== undefined && hero) {
    if (hero.equity - margin > required) verdict = { text: 'Calling makes money in the long run', tone: 'better' }
    else if (hero.equity + margin < required) verdict = { text: 'Calling loses money in the long run', tone: 'worse' }
    else verdict = { text: 'Too close to call', tone: 'even' }
  }

  return (
    <details className="potodds">
      <summary className="section-head disclosure">
        <h2 id={`${id}-title`} className="section-title">
          Should I call?
        </h2>
        <span className="section-note">compare the price of a call with your chance to win</span>
      </summary>
      <p className="section-lede">
        Enter the pot (including the bet {heroLabel === 'You' ? 'you face' : `${heroLabel} faces`}) and the amount to call. This checks the current bet only and ignores future betting.
      </p>
      <div className="potodds-grid">
        <label className="field">
          <span className="label">Pot</span>
          <input className="input mono" inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value)} aria-invalid={!valid ? 'true' : undefined} />
        </label>
        <label className="field">
          <span className="label">To call</span>
          <input className="input mono" inputMode="decimal" value={call} onChange={(e) => setCall(e.target.value)} aria-invalid={!valid ? 'true' : undefined} />
        </label>
        <div className="potodds-out">
          <span className="label">You need</span>
          <span className="mono potodds-num">{required !== undefined ? pct(required, 1) : '·'}</span>
        </div>
        <div className="potodds-out">
          <span className="label">You have</span>
          <span className="mono potodds-num">{hero ? pct(hero.equity, 1) : '·'}</span>
        </div>
        <div className="potodds-out">
          <span className="label" title="Average chips won or lost by calling, over many repeats">Average result</span>
          <span className={`mono potodds-num ${ev !== undefined ? (ev >= 0 ? 'is-better' : 'is-worse') : ''}`}>
            {ev !== undefined ? `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}` : '·'}
          </span>
        </div>
      </div>
      {verdict && (
        <p className={`potodds-verdict is-${verdict.tone}`} aria-live="polite">
          {verdict.text}
        </p>
      )}
    </details>
  )
}
