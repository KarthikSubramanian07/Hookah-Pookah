export function About() {
  return (
    <footer className="about" id="how-it-works">
      <div className="about-grid">
        <section>
          <h2 className="about-title">How the numbers are made</h2>
          <p>
            Every calculation runs in your browser across all of your CPU cores. When the number of possible deals is small enough, Hookah Pookah
            enumerates all of them and the result is <strong>exact</strong>: a heads-up preflop matchup checks all 1,712,304 boards in a few dozen
            milliseconds. Larger spots switch to <strong>Monte Carlo</strong> sampling that keeps going until the 95% confidence interval is as tight as
            you asked for, and the interval is always shown.
          </p>
          <p>
            Ties split the pot, so equity is wins plus your share of every split. Ranges respect card removal: combos that clash with known cards are
            dropped, and overlapping ranges are sampled without bias.
          </p>
        </section>
        <section>
          <h2 className="about-title">Checked against the best open source</h2>
          <ul className="about-list">
            <li>All 133,784,560 seven-card hands match the published category counts (4,824 distinct ranks).</li>
            <li>6.6 million reference hands from PokerHandEvaluator, including PLO4 and PLO5, rank identically.</li>
            <li>Preflop equities match OMPEval's exhaustive enumerator to four decimal places.</li>
            <li>Randomised scenarios with ranges, weights and dead cards match an independent brute-force oracle exactly.</li>
            <li>Monte Carlo intervals are calibrated: 95% intervals contain the exact answer about 95% of the time.</li>
          </ul>
        </section>
        <section>
          <h2 className="about-title">Rules</h2>
          <dl className="about-rules">
            <dt>Texas Hold'em</dt>
            <dd>Best five of seven cards.</dd>
            <dt>Short Deck</dt>
            <dd>Sixes and up. A flush beats a full house and A-6-7-8-9 is the lowest straight. Triton rules rank three of a kind above a straight; classic rules do not.</dd>
            <dt>PLO4 and PLO5</dt>
            <dd>Exactly two hole cards plus exactly three board cards.</dd>
          </dl>
        </section>
      </div>
      <div className="about-foot">
        <span>
          Hookah Pookah is open source under the MIT licence.{' '}
          <a href="https://github.com/KarthikSubramanian07/Hookah-Pookah" rel="noopener">
            Source on GitHub
          </a>
        </span>
        <span className="about-credit">Evaluator ideas from OMPEval, Open PQL and poker-eval.</span>
      </div>
    </footer>
  )
}
