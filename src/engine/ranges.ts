/**
 * Two-card starting hand ranges (Hold'em and Short Deck).
 *
 * Grammar (comma or whitespace separated, case-insensitive ranks):
 *   AA  AKs  AKo  AK            a hand class (AK = suited + offsuit)
 *   QQ+  ATs+  KTo+  A9+        pairs upward, or kicker upward to one below the top card
 *   22-55  A2s-A5s  K9o-KJo     pair ladders and same top card kicker ladders
 *   T9s-54s  JTo-87o            constant-gap ladders (both ranks move together)
 *   AhKh  Td9d                  exact combos
 *   15%  12.5%                  the top N% of combos by preflop all-in equity (vs 3 random hands by default)
 *   10%-25%                     a window of that ordering
 *   random  any  *  XxXx        every combo
 *   <token>:0.5  <token>:50%    weight (0..1), applied to that token
 *   [50]AA, KK[/50]             weight block, also Pio/Flopzilla style [0.5] ... [/0.5]
 * When the same combo appears more than once the later token wins, so "QQ+, AA:0.5" works.
 */

import type { Card } from './cards.ts'
import { RANK_CHARS, SUIT_CHARS, makeCard, parseCards, rankOf, suitOf } from './cards.ts'
import { PREFLOP_EQUITY, type RankingId } from './preflopRanking.ts'
import type { VariantId } from './variants.ts'
import { VARIANTS } from './variants.ts'

/** Map from combo key (see comboKey) to weight in (0, 1]. */
export type RangeMap = Map<number, number>

export interface RangeIssue {
  token: string
  message: string
}

export interface ParsedRange {
  combos: RangeMap
  issues: RangeIssue[]
}

export type ClassKind = 'pair' | 'suited' | 'offsuit'

export interface HandClass {
  /** e.g. "AKs", "QQ", "72o" */
  label: string
  high: number
  low: number
  kind: ClassKind
}

/** Canonical key for an unordered two-card combo: hi * 52 + lo with hi > lo. */
export const comboKey = (a: Card, b: Card): number => (a > b ? a * 52 + b : b * 52 + a)
export const comboFromKey = (key: number): [Card, Card] => [Math.floor(key / 52), key % 52]

export const classCombos = (kind: ClassKind): number => (kind === 'pair' ? 6 : kind === 'suited' ? 4 : 12)

export function classLabel(high: number, low: number, kind: ClassKind): string {
  const base = RANK_CHARS[high] + RANK_CHARS[low]
  return kind === 'pair' ? base : base + (kind === 'suited' ? 's' : 'o')
}

export function parseClassLabel(label: string): HandClass | undefined {
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(label)
  if (!m) return undefined
  let high = RANK_CHARS.indexOf(m[1].toUpperCase())
  let low = RANK_CHARS.indexOf(m[2].toUpperCase())
  if (low > high) [high, low] = [low, high]
  const suffix = m[3].toLowerCase()
  if (high === low) return suffix ? undefined : { label: classLabel(high, low, 'pair'), high, low, kind: 'pair' }
  if (!suffix) return undefined
  const kind: ClassKind = suffix === 's' ? 'suited' : 'offsuit'
  return { label: classLabel(high, low, kind), high, low, kind }
}

/** All combos of a hand class as card pairs. */
export function combosOfClass(high: number, low: number, kind: ClassKind): [Card, Card][] {
  const out: [Card, Card][] = []
  for (let s1 = 0; s1 < 4; s1++)
    for (let s2 = 0; s2 < 4; s2++) {
      if (kind === 'pair' ? s2 <= s1 : kind === 'suited' ? s1 !== s2 : s1 === s2) continue
      out.push([makeCard(high, s1), makeCard(low, s2)])
    }
  return out
}

export function classOfCombo(a: Card, b: Card): HandClass {
  const ra = rankOf(a)
  const rb = rankOf(b)
  const high = Math.max(ra, rb)
  const low = Math.min(ra, rb)
  const kind: ClassKind = ra === rb ? 'pair' : suitOf(a) === suitOf(b) ? 'suited' : 'offsuit'
  return { label: classLabel(high, low, kind), high, low, kind }
}

/** Every hand class in the variant, in 13x13 grid order (row = first rank desc, col = second rank desc). */
export function classGrid(variant: VariantId): HandClass[][] {
  const minRank = VARIANTS[variant].minRank
  const grid: HandClass[][] = []
  for (let r = 12; r >= minRank; r--) {
    const row: HandClass[] = []
    for (let c = 12; c >= minRank; c--) {
      const high = Math.max(r, c)
      const low = Math.min(r, c)
      const kind: ClassKind = r === c ? 'pair' : r > c ? 'suited' : 'offsuit'
      row.push({ label: classLabel(high, low, kind), high, low, kind })
    }
    grid.push(row)
  }
  return grid
}

export const totalCombos = (variant: VariantId): number => {
  const n = VARIANTS[variant].deckSize
  return (n * (n - 1)) / 2
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

class TokenError extends Error {}

function parseWeight(text: string): number {
  const pct = text.endsWith('%')
  const n = Number(pct ? text.slice(0, -1) : text)
  if (!Number.isFinite(n) || n < 0) throw new TokenError(`Invalid weight "${text}"`)
  const w = pct || n > 1 ? n / 100 : n
  if (w > 1) throw new TokenError(`Weight "${text}" is above 100%`)
  return w
}

function classesBetween(a: HandClass, b: HandClass): HandClass[] {
  if (a.kind !== b.kind) throw new TokenError('Both ends of a dash range must be the same type')
  const out: HandClass[] = []
  if (a.kind === 'pair') {
    for (let r = Math.min(a.high, b.high); r <= Math.max(a.high, b.high); r++) out.push(makeClass(r, r, 'pair'))
    return out
  }
  if (a.high === b.high) {
    for (let k = Math.min(a.low, b.low); k <= Math.max(a.low, b.low); k++) out.push(makeClass(a.high, k, a.kind))
    return out
  }
  if (a.high - a.low === b.high - b.low) {
    const gap = a.high - a.low
    for (let h = Math.min(a.high, b.high); h <= Math.max(a.high, b.high); h++) out.push(makeClass(h, h - gap, a.kind))
    return out
  }
  throw new TokenError('Dash ranges need a shared top card (A2s-A5s) or a constant gap (T9s-65s)')
}

const makeClass = (high: number, low: number, kind: ClassKind): HandClass => ({
  label: classLabel(high, low, kind),
  high,
  low,
  kind,
})

/** Class token without suffix ("AK") expands to suited + offsuit; pairs stay as is. */
function expandLoose(token: string): HandClass[] {
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(token)
  if (!m) throw new TokenError(`Unrecognised hand "${token}"`)
  const r1 = RANK_CHARS.indexOf(m[1].toUpperCase())
  const r2 = RANK_CHARS.indexOf(m[2].toUpperCase())
  const high = Math.max(r1, r2)
  const low = Math.min(r1, r2)
  const suffix = m[3].toLowerCase()
  if (high === low) {
    if (suffix) throw new TokenError(`A pair cannot be suited or offsuit ("${token}")`)
    return [makeClass(high, low, 'pair')]
  }
  if (suffix === 's') return [makeClass(high, low, 'suited')]
  if (suffix === 'o') return [makeClass(high, low, 'offsuit')]
  return [makeClass(high, low, 'suited'), makeClass(high, low, 'offsuit')]
}

function expandPlus(token: string): HandClass[] {
  const base = expandLoose(token)
  const out: HandClass[] = []
  for (const cls of base) {
    if (cls.kind === 'pair') for (let r = cls.high; r <= 12; r++) out.push(makeClass(r, r, 'pair'))
    else for (let k = cls.low; k < cls.high; k++) out.push(makeClass(cls.high, k, cls.kind))
  }
  return out
}

function expandDash(left: string, right: string): HandClass[] {
  const a = expandLoose(left)
  const b = expandLoose(right)
  if (a.length !== b.length) throw new TokenError('Both ends of a dash range must be the same type')
  return a.flatMap((cls, i) => classesBetween(cls, b[i]))
}

/** Hand classes ordered strongest first under a preflop ranking. */
export function rankedClasses(variant: VariantId, ranking: RankingId = 'vs3'): HandClass[] {
  return PREFLOP_EQUITY[variant === 'shortdeck' ? 'shortdeck' : 'holdem'][ranking].map(([label]) => parseClassLabel(label)!)
}

/**
 * Hand classes between the `from`% and `to`% marks of the ranking, measured in combos (not grid cells).
 * A class is included when its combo midpoint falls inside the window, so boundaries round to the nearest class.
 */
export function percentClasses(variant: VariantId, from: number, to: number, ranking: RankingId = 'vs3'): HandClass[] {
  const total = totalCombos(variant)
  const lo = (Math.min(Math.max(Math.min(from, to), 0), 100) / 100) * total
  const hi = (Math.min(Math.max(Math.max(from, to), 0), 100) / 100) * total
  const out: HandClass[] = []
  let cum = 0
  for (const cls of rankedClasses(variant, ranking)) {
    const size = classCombos(cls.kind)
    const mid = cum + size / 2
    if (mid > lo && mid <= hi) out.push(cls)
    cum += size
  }
  return out
}

export const topPercentClasses = (variant: VariantId, percent: number, ranking: RankingId = 'vs3'): HandClass[] =>
  percentClasses(variant, 0, percent, ranking)

type Expansion = { kind: 'combos'; combos: [Card, Card][] } | { kind: 'classes'; classes: HandClass[] }

function expandToken(body: string, variant: VariantId, ranking: RankingId): Expansion {
  const t = body.trim()
  if (/^(random|any|all|\*|xxxx|xx)$/i.test(t)) {
    return { kind: 'classes', classes: classGrid(variant).flat() }
  }
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(t)
  if (pct) return { kind: 'classes', classes: percentClasses(variant, 0, Number(pct[1]), ranking) }
  const pctWindow = /^(\d+(?:\.\d+)?)%?-(\d+(?:\.\d+)?)%$/.exec(t)
  if (pctWindow) return { kind: 'classes', classes: percentClasses(variant, Number(pctWindow[1]), Number(pctWindow[2]), ranking) }

  if (/^([2-9TJQKA][cdhs]){2}$/i.test(t)) {
    const [a, b] = parseCards(t)
    if (a === b) throw new TokenError(`Duplicate card in "${t}"`)
    return { kind: 'combos', combos: [[a, b]] }
  }
  const dash = /^([^-]+)-([^-]+)$/.exec(t)
  if (dash) return { kind: 'classes', classes: expandDash(dash[1], dash[2]) }
  if (t.endsWith('+')) return { kind: 'classes', classes: expandPlus(t.slice(0, -1)) }
  return { kind: 'classes', classes: expandLoose(t) }
}

/**
 * Parses range text. Never throws: bad tokens are reported in `issues` and skipped,
 * so the UI can keep showing the valid part of a range while the user types.
 */
export function parseRange(text: string, variant: VariantId = 'holdem', ranking: RankingId = 'vs3'): ParsedRange {
  const combos: RangeMap = new Map()
  const issues: RangeIssue[] = []
  const minRank = VARIANTS[variant].minRank
  const blockWeights: number[] = []

  const rawTokens = text
    .replace(/\[\s*\/\s*[\d.]+%?\s*\]/g, ' ] ')
    .replace(/\[\s*([\d.]+%?)\s*\]/g, ' [$1] ')
    .split(/[\s,;]+/)
    .filter(Boolean)

  for (const raw of rawTokens) {
    if (raw === ']') {
      if (!blockWeights.length) issues.push({ token: raw, message: 'Closing weight block without an opening one' })
      blockWeights.pop()
      continue
    }
    const block = /^\[([\d.]+%?)\]$/.exec(raw)
    try {
      if (block) {
        blockWeights.push(parseWeight(block[1]))
        continue
      }
      const at = raw.lastIndexOf(':')
      const body = at >= 0 ? raw.slice(0, at) : raw
      let weight = blockWeights.length ? blockWeights[blockWeights.length - 1] : 1
      if (at >= 0) weight = parseWeight(raw.slice(at + 1))

      const exp = expandToken(body, variant, ranking)
      const pairs: [Card, Card][] =
        exp.kind === 'combos' ? exp.combos : exp.classes.flatMap((c) => combosOfClass(c.high, c.low, c.kind))
      if (exp.kind === 'classes' && exp.classes.some((c) => c.low < minRank)) {
        throw new TokenError(`"${body}" uses ranks that are not in the short deck`)
      }
      for (const [a, b] of pairs) {
        if (rankOf(a) < minRank || rankOf(b) < minRank) throw new TokenError(`"${body}" uses cards that are not in the short deck`)
        const key = comboKey(a, b)
        if (weight > 0) combos.set(key, weight)
        else combos.delete(key)
      }
    } catch (err) {
      if (err instanceof TokenError || (err instanceof Error && err.name === 'CardParseError')) {
        issues.push({ token: raw, message: err.message })
      } else throw err
    }
  }
  if (blockWeights.length) issues.push({ token: '[', message: 'Unclosed weight block' })
  return { combos, issues }
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const fmtWeight = (w: number): string => (w === 1 ? '' : `:${+(w * 100).toFixed(2)}%`)

/**
 * Compact notation for a range, grouping whole classes into "+" and dash ladders.
 * Classes that are only partly present are written out as exact combos.
 */
export function formatRange(combos: RangeMap, variant: VariantId = 'holdem'): string {
  if (combos.size === 0) return ''
  const minRank = VARIANTS[variant].minRank
  const full = new Map<string, number>() // class label -> uniform weight
  const loose: string[] = []

  for (const cls of classGrid(variant).flat()) {
    const list = combosOfClass(cls.high, cls.low, cls.kind)
    const weights = list.map(([a, b]) => combos.get(comboKey(a, b)) ?? 0)
    const present = weights.filter((w) => w > 0)
    if (!present.length) continue
    if (present.length === list.length && present.every((w) => w === present[0])) {
      full.set(cls.label, present[0])
    } else {
      list.forEach(([a, b], i) => {
        if (weights[i] > 0) {
          const hi = a > b ? a : b
          const lo = a > b ? b : a
          loose.push(RANK_CHARS[rankOf(hi)] + SUIT_CHARS[suitOf(hi)] + RANK_CHARS[rankOf(lo)] + SUIT_CHARS[suitOf(lo)] + fmtWeight(weights[i]))
        }
      })
    }
  }
  if (full.size === classGrid(variant).flat().length && new Set(full.values()).size === 1 && !loose.length) {
    return 'random' + fmtWeight([...full.values()][0])
  }

  const parts: string[] = []
  // Emits maximal runs over an ordered list of labels (strongest first) sharing a weight.
  const emitRuns = (labels: string[], top: string, write: (from: string, to: string) => string) => {
    let i = 0
    while (i < labels.length) {
      const w = full.get(labels[i])
      if (w === undefined) {
        i++
        continue
      }
      let j = i
      while (j + 1 < labels.length && full.get(labels[j + 1]) === w) j++
      const from = labels[i]
      const to = labels[j]
      const text = i === j ? from : from === top ? `${to}+` : write(from, to)
      parts.push(text + fmtWeight(w))
      i = j + 1
    }
  }

  const pairs: string[] = []
  for (let r = 12; r >= minRank; r--) pairs.push(classLabel(r, r, 'pair'))
  emitRuns(pairs, pairs[0], (from, to) => `${from}-${to}`)

  for (const kind of ['suited', 'offsuit'] as const) {
    for (let high = 12; high > minRank; high--) {
      const labels: string[] = []
      for (let low = high - 1; low >= minRank; low--) labels.push(classLabel(high, low, kind))
      emitRuns(labels, labels[0], (from, to) => `${from}-${to}`)
    }
  }
  return [...parts, ...loose].join(', ')
}

/** Per class weight summary for the grid view: fraction of the class's combos present, averaged by weight. */
export function classCoverage(combos: RangeMap, cls: HandClass): number {
  const list = combosOfClass(cls.high, cls.low, cls.kind)
  let sum = 0
  for (const [a, b] of list) sum += combos.get(comboKey(a, b)) ?? 0
  return sum / list.length
}

export function rangeWeightTotal(combos: RangeMap): number {
  let sum = 0
  for (const w of combos.values()) sum += w
  return sum
}
