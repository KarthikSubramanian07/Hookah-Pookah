/**
 * Quick spot entry: one line of text describing a whole situation.
 *
 *   AhKh vs QQ+, AKs vs random on Ks7h2d dead 2c
 *   AsAhKsKh vs ???? | Kd7h6h
 *   Ah vs 22+
 *
 * Players are separated by "vs" (or " v "), the board follows "on", "board" or "|",
 * and dead cards follow "dead". A player is known cards when the text parses as at most
 * the variant's hole card count; "random", "?" or "any" means unknown; anything else is a range.
 */

import type { Card } from '../engine/cards.ts'
import { findDuplicate, formatCard, parseCards } from '../engine/cards.ts'
import { parseRange } from '../engine/ranges.ts'
import type { VariantId } from '../engine/variants.ts'
import { BOARD_SIZE, VARIANTS, cardInDeck } from '../engine/variants.ts'
import { MAX_DEAD, type PlayerSpot, type Spot, newPlayerId } from './spot.ts'

export interface QuickSpotResult {
  spot?: Spot
  error?: string
}

const tryCards = (text: string): Card[] | undefined => {
  const t = text.trim()
  if (!t) return []
  try {
    return parseCards(t.replace(/\?/g, ''))
  } catch {
    return undefined
  }
}

export function parseQuickSpot(input: string, current: Spot): QuickSpotResult {
  const variant: VariantId = current.variant
  const info = VARIANTS[variant]
  let text = input.trim()
  if (!text) return { error: 'Type a spot, for example: AhKh vs QQ+ on Ks7h2d' }

  let deadText = ''
  const deadMatch = /\s+dead\s+(.+)$/i.exec(text)
  if (deadMatch) {
    deadText = deadMatch[1]
    text = text.slice(0, deadMatch.index)
  }
  let boardText = ''
  const boardMatch = /(?:\s+(?:on|board)\s+|\s*\|\s*)(.+)$/i.exec(text)
  if (boardMatch) {
    boardText = boardMatch[1]
    text = text.slice(0, boardMatch.index)
  }

  const parts = text.split(/\s+(?:vs\.?|v)\s+/i).map((s) => s.trim()).filter(Boolean)
  if (parts.length < 1) return { error: 'Add at least one player' }
  if (parts.length > info.maxPlayers) return { error: `${info.shortName} allows at most ${info.maxPlayers} players` }

  const board = tryCards(boardText)
  if (!board) return { error: `Could not read the board "${boardText}"` }
  if (board.length > BOARD_SIZE) return { error: 'The board holds at most five cards' }
  const dead = tryCards(deadText)
  if (!dead) return { error: `Could not read dead cards "${deadText}"` }
  if (dead.length > MAX_DEAD) return { error: `At most ${MAX_DEAD} dead cards` }

  const players: PlayerSpot[] = []
  const allCards: Card[] = [...board, ...dead]
  for (const [i, part] of parts.entries()) {
    const player: PlayerSpot = { id: newPlayerId(), mode: 'cards', cards: Array(info.holeCount).fill(null), range: '' }
    if (/^(random|any|\?+|\*|x+)$/i.test(part)) {
      players.push(player)
      continue
    }
    const cards = tryCards(part)
    if (cards && cards.length <= info.holeCount) {
      cards.forEach((c, j) => (player.cards[j] = c))
      allCards.push(...cards)
      players.push(player)
      continue
    }
    if (!info.supportsRanges) return { error: `Player ${i + 1}: "${part}" is not ${info.holeCount} cards (ranges are Hold'em and Short Deck only)` }
    const parsed = parseRange(part, variant, current.ranking)
    if (!parsed.combos.size) return { error: `Player ${i + 1}: could not read "${part}"` }
    player.mode = 'range'
    player.range = part
    players.push(player)
  }

  const bad = allCards.find((c) => !cardInDeck(variant, c))
  if (bad !== undefined) return { error: `${formatCard(bad)} is not in the ${info.shortName} deck` }
  const dup = findDuplicate(allCards)
  if (dup !== undefined) return { error: `${formatCard(dup)} appears twice` }

  return {
    spot: {
      ...current,
      players,
      board: [...board, ...Array(BOARD_SIZE - board.length).fill(null)],
      dead,
    },
  }
}
