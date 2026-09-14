/**
 * Clean, human readable share URLs.
 *
 *   /holdem?p=AhKh&p=r:QQ+,AKs&p=??&b=Ks7h2d&d=2c
 *   /short-deck?p=AsKs&p=QhQd&rules=classic
 *   /plo?p=AsAhKsKh&p=????&b=Kd7h6h
 *
 * Player values: known cards with "?" for unknown slots, or "r:" + range text.
 * Commas, colons, brackets and percent signs stay readable; "+" is always escaped so it never
 * turns into a space, and parsing never treats "+" as a space either.
 */

import type { Card } from '../engine/cards.ts'
import { formatCard, parseCard } from '../engine/cards.ts'
import type { VariantId } from '../engine/variants.ts'
import { BOARD_SIZE, VARIANTS, cardInDeck } from '../engine/variants.ts'
import { MAX_DEAD, type PlayerSpot, type Spot, defaultSpot, newPlayerId } from './spot.ts'

export const VARIANT_PATHS: Record<VariantId, string> = {
  holdem: '/holdem',
  shortdeck: '/short-deck',
  omaha4: '/plo',
  omaha5: '/plo5',
}

export function variantFromPath(pathname: string): VariantId | undefined {
  const clean = pathname.replace(/\/+$/, '').toLowerCase() || '/'
  const hit = (Object.entries(VARIANT_PATHS) as [VariantId, string][]).find(([, path]) => path === clean)
  return hit?.[0]
}

const encodeValue = (v: string): string =>
  encodeURIComponent(v).replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%5B/gi, '[').replace(/%5D/gi, ']').replace(/%2F/gi, '/').replace(/%3F/gi, '?')

const safeDecode = (v: string): string => {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

function parseQuery(search: string): [string, string][] {
  return search
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=')
      return eq < 0 ? [safeDecode(part), ''] : [safeDecode(part.slice(0, eq)), safeDecode(part.slice(eq + 1))]
    })
}

function cardsToken(cards: (Card | null)[]): string {
  return cards.map((c) => (c === null ? '?' : formatCard(c))).join('')
}

/** Parses "AhK?" style slot strings; returns undefined when malformed. */
function parseSlots(text: string): (Card | null)[] | undefined {
  const out: (Card | null)[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '?' || text[i] === '*') {
      out.push(null)
      i++
      continue
    }
    try {
      const two = text.slice(i, i + 2)
      if (/^10/.test(text.slice(i))) {
        out.push(parseCard(text.slice(i, i + 3)))
        i += 3
      } else {
        out.push(parseCard(two))
        i += 2
      }
    } catch {
      return undefined
    }
  }
  return out
}

export function spotToUrl(spot: Spot): string {
  const params: string[] = []
  for (const p of spot.players) {
    params.push(`p=${encodeValue(p.mode === 'range' ? `r:${p.range.trim().replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ')}` : cardsToken(p.cards))}`)
  }
  const board = spot.board.filter((c): c is Card => c !== null)
  if (board.length) params.push(`b=${cardsToken(board)}`)
  if (spot.dead.length) params.push(`d=${cardsToken(spot.dead)}`)
  if (spot.variant === 'shortdeck' && spot.shortDeckRules === 'classic') params.push('rules=classic')
  if (spot.ranking === 'vs1') params.push('rank=vs1')
  return `${VARIANT_PATHS[spot.variant]}?${params.join('&')}`
}

/**
 * Restores a spot from a location. Anything malformed is dropped rather than rejected,
 * and a URL with no players falls back to the variant's default spot.
 */
export function spotFromUrl(pathname: string, search: string): Spot {
  const variant = variantFromPath(pathname) ?? 'holdem'
  const info = VARIANTS[variant]
  const query = parseQuery(search)
  const base = defaultSpot(variant)
  const playerValues = query.filter(([k]) => k === 'p').map(([, v]) => v)
  if (!playerValues.length) return base

  const seen = new Set<Card>()
  const take = (c: Card | null): Card | null => {
    if (c === null || !cardInDeck(variant, c) || seen.has(c)) return null
    seen.add(c)
    return c
  }

  const players: PlayerSpot[] = playerValues.slice(0, info.maxPlayers).map((value) => {
    const player: PlayerSpot = { id: newPlayerId(), mode: 'cards', cards: Array(info.holeCount).fill(null), range: '' }
    if (/^r:/i.test(value) && info.supportsRanges) {
      player.mode = 'range'
      player.range = value.slice(2)
      return player
    }
    const slots = parseSlots(value.trim()) ?? []
    for (let i = 0; i < info.holeCount; i++) player.cards[i] = take(slots[i] ?? null)
    return player
  })

  const get = (key: string) => query.find(([k]) => k === key)?.[1]
  const boardSlots = parseSlots(get('b') ?? '') ?? []
  const board: (Card | null)[] = Array(BOARD_SIZE).fill(null)
  let bi = 0
  for (const c of boardSlots) {
    if (bi >= BOARD_SIZE) break
    const kept = take(c)
    if (kept !== null) board[bi++] = kept
  }
  const dead = (parseSlots(get('d') ?? '') ?? []).map(take).filter((c): c is Card => c !== null).slice(0, MAX_DEAD)

  return {
    variant,
    shortDeckRules: get('rules') === 'classic' ? 'classic' : 'triton',
    ranking: get('rank') === 'vs1' ? 'vs1' : 'vs3',
    players,
    board,
    dead,
  }
}
