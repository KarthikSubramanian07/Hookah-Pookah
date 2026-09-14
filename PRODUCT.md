# Product

## Register

product

## Platform

web

## Users

Poker players studying spots: recreational grinders checking a hand after a session, serious students running range versus range questions, and home game players settling arguments at the table on a phone. They arrive with a concrete spot in their head (cards, board, what the opponent might hold) and want a trustworthy number fast.

## Purpose

Answer "what are my chances?" for any Hold'em, Short Deck, PLO4 or PLO5 situation: equity, win and tie odds, the chance of making each hand type, and how every possible next card changes things. Accuracy is the product. Every number shows whether it is exact or a Monte Carlo estimate with its error bar.

## Positioning

The most accurate free odds calculator on the web: exhaustive enumeration whenever it is feasible, honest confidence intervals when it is not, verified against independent open-source evaluators, running entirely in the browser.

## Brand personality

Precise, unhurried, a little mischievous. A late-night card room with a sense of humour about its own name, and a mathematician's refusal to round a number it cannot defend.

References: t3.codes (dense, confident dark UI, monospaced numerals, no decoration that does not carry information); Anthropic (calm typographic hierarchy, warmth through a single restrained accent rather than surfaces); Linear (keyboard-first, instant).

## Anti-references

- Ad-heavy poker affiliate calculators (CardPlayer, 888, PokerListings): cluttered, felt-green tables, casino chrome.
- Casino skeuomorphism: green felt, gold gradients, chip stacks, neon.
- Generic dashboard templates: identical stat cards, hero metrics, gradient text.
- Equilab-era desktop UI: modal chains, Evaluate buttons, tiny targets.

## Design principles

1. Numbers first. Equity is the largest thing on screen; precision and method sit right beside it.
2. Never block the user. Calculations run live, cancel on edit, and invalid input degrades gracefully with inline explanations.
3. Keyboard and touch are equals. Everything typed can be tapped and everything tapped can be typed.
4. Honest precision. Only show digits the math supports.
5. Colour carries meaning (players, suits, better or worse), never decoration.

## Accessibility

WCAG 2.2 AA. Four-colour suits plus suit glyphs so suits never rely on colour alone. Full keyboard operation including the range grid. Respects prefers-reduced-motion. Touch targets at least 40px on mobile.
