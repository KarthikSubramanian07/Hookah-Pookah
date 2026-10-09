import type { VariantId } from '../engine/variants.ts'

/** Page titles per game, shared by the running app and the post-build route pages. */
export const VARIANT_TITLES: Record<VariantId, string> = {
  holdem: "Hookah Pookah poker calculator: Texas Hold'em equity and ranges",
  shortdeck: 'Hookah Pookah poker calculator: Short Deck (6+) Triton and classic',
  omaha4: 'Hookah Pookah poker calculator: PLO4 Pot Limit Omaha equity',
  omaha5: 'Hookah Pookah poker calculator: PLO5 five-card Omaha equity',
}
