import type { PlayerSpot } from '../../state/spot.ts'
import { playerLabel } from '../../state/spot.ts'
import { PRECISION_HALF_WIDTH, type EquityState, type Precision } from '../useEquity.ts'
import { Z95, compact, decimalsFor, duration, int, odds, pct } from '../format.ts'

interface Props {
  equity: EquityState
  players: PlayerSpot[]
  precision: Precision
  onPrecision: (p: Precision) => void
}

const PRECISIONS: Precision[] = ['fast', 'standard', 'fine']

export function EquitySummary({ equity, players, precision, onPrecision }: Props) {
  const { result, status } = equity
  const running = status === 'running'
  const stale = running && result !== undefined && result.players.length !== players.length
  const shown = stale ? undefined : result
  const worstHalfWidth = shown && shown.method === 'montecarlo' ? Math.max(...shown.players.map((p) => p.stdErr)) * Z95 * 100 : 0

  return (
    <section className="summary" aria-labelledby="summary-title">
      <div className="section-head">
        <h2 id="summary-title" className="section-title">
          Equity
        </h2>
        <div className="section-actions">
          <div className="segmented" role="group" aria-label="Monte Carlo precision target">
            {PRECISIONS.map((p) => (
              <button key={p} type="button" aria-pressed={precision === p} onClick={() => onPrecision(p)} title={`Stop sampling at ±${PRECISION_HALF_WIDTH[p]}% (95% interval)`}>
                ±{PRECISION_HALF_WIDTH[p]}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="method" data-state={status}>
        {status === 'invalid' ? (
          <span className="method-badge is-muted">Waiting for a complete spot</span>
        ) : status === 'error' ? (
          <span className="method-badge is-error" role="alert">
            {equity.error}
          </span>
        ) : shown ? (
          <>
            <span className={`method-badge ${shown.method === 'exact' ? 'is-exact' : 'is-mc'}`}>
              {shown.method === 'exact' ? 'Exact' : 'Monte Carlo'}
            </span>
            <span className="method-detail mono">
              {shown.method === 'exact'
                ? `${int(shown.samples)} deals enumerated`
                : `±${worstHalfWidth.toFixed(worstHalfWidth < 0.1 ? 3 : 2)}% at 95% · ${compact(shown.samples)} trials`}
            </span>
            <span className="method-detail mono">
              {duration(shown.elapsedMs)}
              {shown.method === 'montecarlo' && shown.elapsedMs > 0 && ` · ${compact((shown.samples / shown.elapsedMs) * 1000)}/s · ${shown.shards} cores`}
            </span>
            {running && shown.method === 'montecarlo' && (
              <button type="button" className="btn btn-sm btn-ghost method-stop" onClick={equity.stop}>
                Stop
              </button>
            )}
          </>
        ) : (
          <span className="method-badge is-muted">Calculating…</span>
        )}
        <span className="progress" aria-hidden="true">
          <span className="progress-fill" style={{ transform: `scaleX(${running ? (shown?.progress ?? 0.04) : status === 'done' ? 1 : 0})` }} data-running={running} />
        </span>
      </div>

      <ol className="equity-bars">
        {players.map((player, i) => {
          const r = shown?.players[i]
          const decimals = r ? decimalsFor(shown!, r.stdErr) : 1
          return (
            <li key={player.id} className="equity-bar" style={{ '--player': `var(--p${(i % 10) + 1})` } as React.CSSProperties}>
              <span className="equity-bar-name">{playerLabel(i)}</span>
              <span className="equity-bar-track" aria-hidden="true">
                <span className="equity-bar-win" style={{ width: `${(r?.win ?? 0) * 100}%` }} />
                <span className="equity-bar-tie" style={{ width: `${r ? (r.equity - r.win) * 100 : 0}%` }} />
                {r && shown?.method === 'montecarlo' && (
                  <span
                    className="equity-bar-ci"
                    style={{ left: `${(r.equity - Z95 * r.stdErr) * 100}%`, width: `${2 * Z95 * r.stdErr * 100}%` }}
                  />
                )}
              </span>
              <span className="equity-bar-value mono" aria-label={r ? `${playerLabel(i)} equity ${pct(r.equity, decimals)}` : undefined}>
                {r ? pct(r.equity, decimals) : '·'}
              </span>
              <span className="equity-bar-odds mono">{r ? odds(r.equity) : ''}</span>
            </li>
          )
        })}
      </ol>
      <p className="equity-legend">
        <span className="legend-swatch is-win" aria-hidden="true" /> wins outright <span className="legend-swatch is-tie" aria-hidden="true" /> split pots
        {shown?.method === 'montecarlo' && (
          <>
            {' '}
            <span className="legend-swatch is-ci" aria-hidden="true" /> 95% interval
          </>
        )}
      </p>
    </section>
  )
}
