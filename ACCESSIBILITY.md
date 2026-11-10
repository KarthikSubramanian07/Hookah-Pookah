# Accessibility

Hookah Pookah targets **WCAG 2.2 Level AA**.

## What was tested

- Automated: axe-core (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) on Hold'em, Short Deck, PLO4, PLO5 and About, including empty, results, loading, range-error, card picker, advanced range editor and pot-odds states, at 1440×900, 390×844 and 320×800.
- Manual: keyboard operation of slots, picker (focus trap, Escape), ranges and next-card grid; visible focus; skip link; landmarks and headings; live regions for equity and next-card summary; `lang` and document title; reduced-motion; colour is not the only cue on the next-card heatmap (numeric values and summary text).

## Known limitations

- The next-card heatmap is dense. Cells are at least 24×24 CSS pixels; on viewports near 320px wide the grid may scroll horizontally so targets stay large enough.
- Monte Carlo estimates keep updating while they run; the answer region is a polite live region rather than a pause control, because there is no decorative animation longer than five seconds to stop.

## Reporting a barrier

Open an issue on the repository describing the page, the assistive technology or browser, and what went wrong.
