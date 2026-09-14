import type { VariantId } from '../engine/variants.ts'

/** Page titles per game, shared by the running app and the post-build route pages. */
export const VARIANT_TITLES: Record<VariantId, string> = {
  holdem: "Texas Hold'em odds calculator: exact equity and ranges · Hookah Pookah",
  shortdeck: "Short Deck (6+) Hold'em odds calculator, Triton and classic rules · Hookah Pookah",
  omaha4: 'PLO equity calculator: Pot Limit Omaha odds, exact · Hookah Pookah',
  omaha5: '5 Card PLO odds calculator: PLO5 equity · Hookah Pookah',
}
