/**
 * Card model.
 *
 * A card is an integer 0..51: `rank * 4 + suit`.
 * rank: 0 = deuce ... 12 = ace. suit: 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades.
 */

export type Card = number

export const RANK_CHARS = '23456789TJQKA'
export const SUIT_CHARS = 'cdhs'
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const
export const RANK_NAMES = [
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
] as const

export const rankOf = (card: Card): number => card >> 2
export const suitOf = (card: Card): number => card & 3
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit

export function parseRank(ch: string): number {
  const r = RANK_CHARS.indexOf(ch.toUpperCase())
  if (r < 0) throw new CardParseError(`Unknown rank "${ch}"`)
  return r
}

export function parseSuit(ch: string): number {
  const s = SUIT_CHARS.indexOf(ch.toLowerCase())
  if (s < 0) throw new CardParseError(`Unknown suit "${ch}"`)
  return s
}

export class CardParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardParseError'
  }
}

/** Parses a single card such as "Ah", "td", "10s". */
export function parseCard(text: string): Card {
  const t = text.trim()
  const m = /^(10|[2-9tjqka])([cdhs])$/i.exec(t)
  if (!m) throw new CardParseError(`Invalid card "${text}"`)
  const rank = m[1] === '10' ? 8 : parseRank(m[1])
  return makeCard(rank, parseSuit(m[2]))
}

/**
 * Parses a run of cards: "AhKd", "Ah Kd", "ah,kd,10c". Whitespace and commas are ignored.
 * Throws on unparseable input. Does not check duplicates (see `findDuplicate`).
 */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/[\s,;]+/g, '')
  const cards: Card[] = []
  const re = /(10|[2-9tjqka])([cdhs])/iy
  let pos = 0
  while (pos < compact.length) {
    re.lastIndex = pos
    const m = re.exec(compact)
    if (!m) throw new CardParseError(`Invalid card near "${compact.slice(pos, pos + 3)}"`)
    cards.push(makeCard(m[1] === '10' ? 8 : parseRank(m[1]), parseSuit(m[2])))
    pos = re.lastIndex
  }
  return cards
}

export const formatCard = (card: Card): string => RANK_CHARS[rankOf(card)] + SUIT_CHARS[suitOf(card)]

export const formatCards = (cards: readonly Card[], sep = ''): string => cards.map(formatCard).join(sep)

export function findDuplicate(cards: readonly Card[]): Card | undefined {
  const seen = new Uint8Array(52)
  for (const c of cards) {
    if (seen[c]) return c
    seen[c] = 1
  }
  return undefined
}

export const isValidCard = (card: unknown): card is Card =>
  typeof card === 'number' && Number.isInteger(card) && card >= 0 && card < 52
