/**
 * Exact board enumeration with OMPEval's irrelevant-suit merging, generalised to Omaha and short deck.
 *
 * A suit is irrelevant at some depth when no player can finish with a flush in it however the remaining
 * board cards fall. Same-rank cards of irrelevant suits are then interchangeable for every player, so
 * instead of enumerating them separately we take `rep` of the `m` such cards once, with weight C(m, rep).
 *
 *   Hold'em / short deck: flush needs 5 of a suit among one player's hole + board
 *       relevant(s) <=> maxHole[s] + boardCount[s] + cardsLeft >= 5
 *   Omaha: flush needs exactly 2 hole + 3 board of a suit
 *       relevant(s) <=> maxHole[s] >= 2 && boardCount[s] + cardsLeft >= 3
 * Both are expressed as `level[s] + cardsLeft >= 5`, with level[s] = maxHole + board (Hold'em) or
 * board + 2 (Omaha, players with 2+ of the suit) or -99 (Omaha, nobody has 2).
 *
 * Integration (equity.ts runExact): replace `dealBoard(0, 0)` inside dealSlots with
 *   isoEnumerate(deck, used, table.hole, n, prep.holeCount, prep.mustUseTwo, table.boardCards, boardStart, boardNeed,
 *                (w) => table.showdown(weight * w))
 * All hole cards are fixed by the time boards are dealt (random hole cards are dealt first), so this is valid
 * for known cards, ranges and random players alike. Table.samples must add the multiplicity `w` instead of 1
 * if it is meant to count distinct deals.
 */

const BINOM = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1]]

export function isoEnumerate(
  deckIn: readonly number[],
  used: Uint8Array,
  hole: Int32Array,
  n: number,
  holeCount: number,
  mustUseTwo: boolean,
  boardCards: Int32Array,
  boardStart: number,
  boardNeed: number,
  visit: (multiplicity: number) => void,
): void {
  if (boardNeed === 0) {
    visit(1)
    return
  }
  // Live deck in ascending id order keeps equal ranks adjacent (id = rank * 4 + suit).
  const deck = new Int32Array(deckIn.length)
  let ndeck = 0
  for (let i = 0; i < deckIn.length; i++) if (!used[deckIn[i]]) deck[ndeck++] = deckIn[i]

  const level = new Int32Array(4)
  const maxHole = [0, 0, 0, 0]
  for (let p = 0; p < n; p++) {
    const per = [0, 0, 0, 0]
    for (let i = 0; i < holeCount; i++) per[hole[p * holeCount + i] & 3]++
    for (let s = 0; s < 4; s++) if (per[s] > maxHole[s]) maxHole[s] = per[s]
  }
  const boardCount = [0, 0, 0, 0]
  for (let i = 0; i < boardStart; i++) boardCount[boardCards[i] & 3]++
  for (let s = 0; s < 4; s++) {
    if (!mustUseTwo) level[s] = maxHole[s] + boardCount[s]
    else level[s] = maxHole[s] >= 2 ? boardCount[s] + 2 : -99
  }

  const rec = (pos: number, cardsLeft: number, start: number, weight: number): void => {
    if (cardsLeft === 1) {
      if (level[0] < 4 && level[1] < 4 && level[2] < 4 && level[3] < 4) {
        for (let i = start; i < ndeck; ) {
          let mult = 1
          const card = deck[i]
          const rank = card >> 2
          for (++i; i < ndeck && deck[i] >> 2 === rank; ++i) ++mult
          boardCards[pos] = card
          visit(mult * weight)
        }
      } else {
        let lastRank = -1
        for (let i = start; i < ndeck; ++i) {
          let mult = 1
          const card = deck[i]
          if (level[card & 3] < 4) {
            const rank = card >> 2
            if (rank === lastRank) continue
            for (let j = i + 1; j < ndeck && deck[j] >> 2 === rank; ++j) if (level[deck[j] & 3] < 4) ++mult
            lastRank = rank
          }
          boardCards[pos] = card
          visit(mult * weight)
        }
      }
      return
    }
    for (let i = start; i < ndeck; ++i) {
      const card = deck[i]
      const suit = card & 3
      if (level[suit] + cardsLeft < 5) {
        let irrelevant = 1
        const rank = card >> 2
        for (let j = i + 1; j < ndeck && deck[j] >> 2 === rank; ++j) {
          if (level[deck[j] & 3] + cardsLeft < 5) {
            if (j !== i + irrelevant) {
              const tmp = deck[j]
              deck[j] = deck[i + irrelevant]
              deck[i + irrelevant] = tmp
            }
            ++irrelevant
          }
        }
        const maxRep = irrelevant < cardsLeft ? irrelevant : cardsLeft
        for (let rep = 1; rep <= maxRep; ++rep) {
          boardCards[pos + rep - 1] = deck[i + rep - 1]
          const w = BINOM[irrelevant][rep] * weight
          if (rep === cardsLeft) visit(w)
          else rec(pos + rep, cardsLeft - rep, i + irrelevant, w)
        }
        i += irrelevant - 1
      } else {
        boardCards[pos] = card
        ++level[suit]
        rec(pos + 1, cardsLeft - 1, i + 1, weight)
        --level[suit]
      }
    }
  }
  rec(boardStart, boardNeed, 0, 1)
}
