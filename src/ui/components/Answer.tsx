import type { PlayerSpot } from '../../state/spot.ts'
import { playerLabel } from '../../state/spot.ts'
import { Z95, compact, decimalsFor, duration, int, odds, pct, verdict } from '../format.ts'
import { PRECISION_HALF_WIDTH, type EquityState, type Precision } from '../useEquity.ts'

interface Props {
  equity: EquityState
  players: PlayerSpot[]
  advanced: boolean
  precision: Precision
  onPrecision: (p: Precision) => void
  /** Why no answer can be shown yet, in plain words. */
  blocker: string | undefined
}

const PRECISIONS: Precision[] = ['fast', 'standard', 'fine']

export function Answer({ equity, players, advanced, precision, onPrecision, blocker }: Props) {
  const { result, status } = equity
  const running = status === 'running'
  const shown = result && result.players.length === players.length ? result : undefined
  const hero = shown?.players[0]
  const heroDecimals = hero ? Math.min(decimalsFor(shown!, hero.stdErr), 1) : 1
  const halfWidth = shown && shown.method === 'montecarlo' ? Math.max(...shown.players.map((p) => p.stdErr)) * Z95 * 100 : 0
  const v = hero ? verdict(hero.equity, players.length) : undefined
  const lose = hero ? Math.max(0, 1 - hero.win - hero.tie) : 0

  return (
    <section className="answer" aria-labelledby="answer-title" data-state={status}>
      <h2 id="answer-title" className="answer-title">
        Your chance to win
      </h2>

      {status === 'error' ? (
        <p className="answer-blocker is-error" role="alert">
          {equity.error}
        </p>
      ) : !shown && (status === 'invalid' || blocker) ? (
        <p className="answer-blocker">{blocker ?? 'Finish setting up the hand to see your odds.'}</p>
      ) : (
        <>
          <div className={`answer-main${running && !hero ? ' is-loading' : ''}${running && hero ? ' is-stale' : ''}`} aria-live="polite">
            <span className="answer-big mono">{hero ? pct(hero.equity, heroDecimals) : '··'}</span>
            {v && <span className={`verdict is-${v.tone}`}>{v.label}</span>}
          </div>
          {hero && (
            <p className="answer-line">
              <span>
                Win <strong className="mono">{pct(hero.win, 1)}</strong>
              </span>
              <span title="Both of you end with the same hand and share the pot. It counts as part of your chance to win.">
                Split <strong className="mono">{pct(hero.tie, 1)}</strong>
              </span>
              <span>
                Lose <strong className="mono">{pct(lose, 1)}</strong>
              </span>
              {players.length > 1 && <span className="answer-odds">odds {odds(hero.equity)}</span>}
            </p>
          )}

          {players.length > 1 && (
            <ol className="answer-bars" aria-label="Chance to win for each player">
              {players.map((player, i) => {
                const r = shown?.players[i]
                return (
                  <li key={player.id} className="answer-bar" style={{ '--player': `var(--p${(i % 10) + 1})` } as React.CSSProperties}>
                    <span className="answer-bar-name">{playerLabel(i)}</span>
                    <span className="answer-bar-track" aria-hidden="true">
                      <span className="answer-bar-fill" style={{ width: `${(r?.equity ?? 0) * 100}%` }} />
                      {advanced && r && shown?.method === 'montecarlo' && (
                        <span className="answer-bar-ci" style={{ left: `${(r.equity - Z95 * r.stdErr) * 100}%`, width: `${2 * Z95 * r.stdErr * 100}%` }} />
                      )}
                    </span>
                    <span className="answer-bar-value mono">{r ? pct(r.equity, decimalsFor(shown!, r.stdErr)) : '·'}</span>
                  </li>
                )
              })}
            </ol>
          )}

          <div className="answer-meta">
            {shown ? (
              shown.method === 'exact' ? (
                <span className="method-note is-exact" title={`${int(shown.samples)} deals enumerated in ${duration(shown.elapsedMs)}`}>
                  Exact: every possible deal was checked
                </span>
              ) : (
                <span className="method-note is-mc" title={`${compact(shown.samples)} simulated deals in ${duration(shown.elapsedMs)}`}>
                  {running ? 'Estimating' : 'Estimate'}, accurate to ±{halfWidth.toFixed(halfWidth < 0.1 ? 2 : 1)}%
                </span>
              )
            ) : (
              <span className="method-note">Calculating…</span>
            )}
            {running && shown?.method === 'montecarlo' && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={equity.stop}>
                Stop
              </button>
            )}
            <span className="progress" aria-hidden="true">
              <span className="progress-fill" style={{ transform: `scaleX(${running ? (shown?.progress ?? 0.05) : status === 'done' ? 1 : 0})` }} data-running={running} />
            </span>
          </div>

          {advanced && (
            <div className="answer-advanced">
              {shown && (
                <p className="mono answer-stats">
                  {shown.method === 'exact' ? `${int(shown.samples)} deals enumerated` : `${compact(shown.samples)} trials on ${shown.shards} cores, ${compact((shown.samples / Math.max(shown.elapsedMs, 1)) * 1000)}/s`}{' '}
                  in {duration(shown.elapsedMs)}
                </p>
              )}
              <div className="segmented" role="group" aria-label="Estimate precision">
                {PRECISIONS.map((p) => (
                  <button key={p} type="button" aria-pressed={precision === p} onClick={() => onPrecision(p)} title={`When sampling, stop at ±${PRECISION_HALF_WIDTH[p]}% (95% confidence)`}>
                    ±{PRECISION_HALF_WIDTH[p]}%
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
