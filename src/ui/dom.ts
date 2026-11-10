import type { Card } from '../engine/cards.ts'
import { RANK_CHARS, RANK_NAMES, SUIT_NAMES, SUIT_SYMBOLS, rankOf, suitOf } from '../engine/cards.ts'

export const cardName = (card: Card): string => `${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`

/** Visible face text drawn on a card (e.g. "A♠", "10♥") for label-in-name. */
export const cardFace = (card: Card): string => {
  const rank = RANK_CHARS[rankOf(card)]
  return `${rank === 'T' ? '10' : rank}${SUIT_SYMBOLS[suitOf(card)]}`
}

export const slotId = (key: string) => `slot-${key}`

/** Focuses the next empty slot after `fromKey` in document order, optionally within one group. */
export function focusNextSlot(fromKey: string, group?: string): string | undefined {
  const all = [...document.querySelectorAll<HTMLElement>('[data-slot]')]
  const index = all.findIndex((el) => el.dataset.slot === fromKey)
  const rest = all.slice(index + 1).filter((el) => !group || el.dataset.slotGroup === group)
  const target = rest.find((el) => el.dataset.empty === 'true')
  target?.focus()
  return target?.dataset.slot
}

/** Heat colour from 0 (cold, losing) to 1 (hot, winning) in OKLCH. */
export function heat(equity: number): string {
  const t = Math.max(0, Math.min(1, equity))
  const hue = 27 + t * 131
  const chroma = 0.06 + Math.abs(t - 0.5) * 0.22
  return `oklch(0.62 ${chroma.toFixed(3)} ${hue.toFixed(0)})`
}
