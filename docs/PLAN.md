# Hookah Pookah: build plan

Status: research and engine stress testing done; this plan governs the remaining build.

## 1. What we learned from existing tools

| Project | What we take | What we avoid |
|---|---|---|
| pokersource poker-eval (GPL, read only) | Suit-mask evaluation: pairs, trips and quads read from XOR/AND of four 13-bit masks | GPL code; its early return on straight/flush breaks re-ranked variants |
| OMPEval (ISC) | Exact odometer over range combos, per-player stderr stopping, tie split 1/k | Player-0-only stderr, no weights, no dash ranges, 6 player cap |
| PokerHandEvaluator (Apache-2.0) | Its 6.6M row test corpus as an external oracle | 30 to 350 MB PLO tables (browser hostile) |
| PokerStove (BSD-3) | Enumerate/Monte Carlo split, "equity vs 3 random" percent ordering | Tie over-count bug (#16) |
| eval7 (MIT) | Range grammar coverage (spans, `+`, weights) | Monte Carlo that ignores weights |
| rundef poker-odds-calculator, holdem_calc | Nothing beyond UX ideas | Math.random, unsplit ties, "equity" that is really win% |
| Open PQL (MIT) | Short deck and PLO5 support scope | Straight > trips hardcoded |
| Equilab, Flopzilla, PokerCruncher, GTO Wizard, CardPlayer, PokerNews, HoldemCalc | Grid painting, weight brush, next-card heatmap, hit vs make, URL sharing, auto-stop | Evaluate buttons, unbounded exact runs, MC digits without error bars, per-variant apps, click-only grids |

## 2. Verified engine (already built)

- `src/engine/evaluator.ts`: suit-mask evaluator, rule tables for standard, short deck Triton (trips > straight) and short deck classic.
- `src/engine/equity.ts`: exact enumeration and Monte Carlo over known, partial, random and weighted-range players; win, tie, equity, stderr and hand-category distributions; next-card analysis.
- `src/engine/ranges.ts`: range grammar (`AA`, `AKs`, `QQ+`, `A2s-A5s`, `T9s-65s`, `AhKh`, `15%`, `random`, `:0.5`, `[50]...[/50]`).

Verification results so far:

| Check | Result |
|---|---|
| Exhaustive 5 and 7 card category counts, 52 and 36 card decks | exact match to published and independently enumerated counts; 7462 / 4824 / 1404 / 762 classes |
| PokerHandEvaluator corpus (5, 6, 7 card, PLO4, PLO5; 6.6M rows) | 0 inconsistencies, 0 ordering violations |
| Exact heads-up and 3-way equities vs OMPEval and brute force | identical to 4 decimals (Hold'em, PLO4, PLO5, short deck both rule sets) |
| 300 random scenarios vs independent brute-force oracle (ranges, weights, partial hands, dead cards) | 0 mismatches, max diff 2.9e-15 |
| Monte Carlo calibration, 300 seeds x 7 scenarios | mean z about 0, var z 0.92 to 1.19, 95% coverage 93 to 97% |

Finding worth recording: third-party short deck equities (AsAh vs KsKh 75.0243%) are computed with classic rules. Triton rules give 74.9618%, confirmed by brute force.

## 3. Product scope

Must have
1. Variants: Hold'em, Short Deck (Triton or classic toggle), PLO4, PLO5. State kept per variant.
2. Players 1 to 10 (PLO5: 9). Each player: exact cards, partial cards, random, or range (Hold'em and Short Deck).
3. Card entry three ways: type into a slot (`ah`, `10d`, Backspace steps back, auto-advance), a 4x13 deck picker where used cards show their owner, and a quick-spot box (`AhKh vs QQ+ vs random on Ks7h2d dead 2c`).
4. Board (flop, turn, river slots) and dead cards. Conflicts move the card and flash the previous owner.
5. Range editor: text and 13x13 grid always in sync; pointer-capture drag painting (mode set by first cell), weight brush, per-combo suit popover, top X% slider with from/to handles and ordering choice (vs 1 or vs 3 random), combo count and % of deck, undo/redo, inline token errors that never block calculation.
6. Results: equity, win, tie per player with stacked bars; exact badge or Monte Carlo 95% interval, sample count, hands/s; precision target (0.5 / 0.1 / 0.02 %); stop/resume; auto recalc with cancel on edit.
7. Hand-category chances per player (made by the river), respecting PLO 2+3 and short deck ordering.
8. Next-card heatmap on flop and turn: hero equity per possible card, delta colouring, outs count, click to deal.
9. Equity by villain hand class: per range combo accumulators, shown as a heatmap over the villain grid.
10. Shareable clean URLs (`/holdem`, `/short-deck`, `/plo`, `/plo5`) with spot state in the query string; copy link.
11. Pot odds panel: pot and call give required equity against current equity.
12. Accessibility: keyboard reachable everything, ARIA grid, suits never colour only, reduced motion.

Should have (in this release)
- Presets for opponents: N random hands; saved ranges in localStorage.
- Randomize spot, swap/reorder players, clear per section.
- Street timeline: hero equity preflop, flop, turn, river when a board is given.

Out of scope (documented): PLO range syntax, Stud and draw games, hi/lo split pots, solver features.

## 4. Architecture

```
src/engine/     pure TypeScript, no DOM; runs in Node, Vitest and Web Workers
src/worker/     worker entry, message protocol, pool that shards Monte Carlo across cores
src/state/      spot model, URL codec, quick-spot parser, reducers, undo history
src/ui/         React components and CSS (no component library)
scripts/        preflop ranking generator, post-build SEO pages, OG image, stress suite
tests/          Vitest unit and oracle tests, reference brute-force evaluator
e2e/            Playwright flows against the production build
```

Worker protocol: `run {id, request}` produces `progress {id, snapshot}` messages and one `result` or `error`. Cancel terminates the worker and replaces it, so long exact runs never block. Monte Carlo shards run with distinct seeds; the pool merges raw accumulators (weights, equity sums, squared sums, category counts) so the merged stderr is exact.

Preflop orderings: generated by `scripts/gen-preflop-ranking.ts` with the engine itself (Monte Carlo, worker threads, 20M+ trials per class, seeded), for Hold'em and Short Deck, vs 1 and vs 3 random hands. Committed as data with the generator.

## 5. Quality gates

- Unit and oracle tests (Vitest): evaluator exhaustive 5-card counts, sampled 7-card vs naive reference, all reference equities, seeded fuzz vs brute force, calibration, range grammar, URL codec, worker merge.
- `pnpm test:stress`: exhaustive 7-card counts for all rule sets, long fuzz, long calibration (CI weekly and on demand).
- Playwright e2e on the built site: core flows, share URL round trip, variant switch, grid painting, next-card heatmap, mobile viewport.
- Visual verification by screenshots at desktop and mobile sizes before release.
- GitHub Actions: lint, typecheck, unit, build, e2e on every push and PR.
- Deploy: Cloudflare Pages project `hookah-pookah` (hookah-pookah.pages.dev), built from `main`.

## 6. Design direction

Smoky lounge after hours: near-black warm charcoal, ember orange accent, cream text, felt green used sparingly for positive deltas. Fraunces for display, Inter Tight for UI, JetBrains Mono for every number. Four-colour suits. Cards drawn in CSS, crisp at any size. Motion limited to progress and value transitions.
