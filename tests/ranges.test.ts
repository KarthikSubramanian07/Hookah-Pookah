import { describe, expect, it } from 'vitest'
import { formatCards, parseCards } from '../src/engine/cards.ts'
import { PREFLOP_EQUITY } from '../src/engine/preflopRanking.ts'
import {
  classCoverage,
  classGrid,
  classOfCombo,
  combosOfClass,
  comboFromKey,
  comboKey,
  formatRange,
  parseClassLabel,
  parseRange,
  percentClasses,
  rangeWeightTotal,
  rankedClasses,
  topPercentClasses,
  totalCombos,
} from '../src/engine/ranges.ts'

const size = (text: string, variant: 'holdem' | 'shortdeck' = 'holdem') => parseRange(text, variant).combos.size
const labels = (text: string) => {
  const set = new Set<string>()
  for (const key of parseRange(text).combos.keys()) {
    const [a, b] = comboFromKey(key)
    set.add(classOfCombo(a, b).label)
  }
  return [...set].sort()
}

describe('combo helpers', () => {
  it('builds canonical keys independent of card order', () => {
    const [a, b] = parseCards('AhKd')
    expect(comboKey(a, b)).toBe(comboKey(b, a))
    expect(comboFromKey(comboKey(b, a))).toEqual([a, b])
  })
  it('counts combos per class', () => {
    expect(combosOfClass(12, 12, 'pair')).toHaveLength(6)
    expect(combosOfClass(12, 11, 'suited')).toHaveLength(4)
    expect(combosOfClass(12, 11, 'offsuit')).toHaveLength(12)
    expect(classGrid('holdem').flat()).toHaveLength(169)
    expect(classGrid('shortdeck').flat()).toHaveLength(81)
    expect(totalCombos('holdem')).toBe(1326)
    expect(totalCombos('shortdeck')).toBe(630)
  })
  it('lays out the grid with suited hands above the diagonal', () => {
    const grid = classGrid('holdem')
    expect(grid[0][0].label).toBe('AA')
    expect(grid[0][1].label).toBe('AKs')
    expect(grid[1][0].label).toBe('AKo')
    expect(grid[12][12].label).toBe('22')
  })
  it('parses class labels', () => {
    expect(parseClassLabel('KAs')?.label).toBe('AKs')
    expect(parseClassLabel('AAs')).toBeUndefined()
    expect(parseClassLabel('AK')).toBeUndefined()
    expect(parseClassLabel('zz')).toBeUndefined()
  })
})

describe('parseRange grammar', () => {
  it('expands classes', () => {
    expect(size('AA')).toBe(6)
    expect(size('AKs')).toBe(4)
    expect(size('AKo')).toBe(12)
    expect(size('AK')).toBe(16)
    expect(size('ka')).toBe(16)
  })
  it('expands plus notation', () => {
    expect(labels('QQ+')).toEqual(['AA', 'KK', 'QQ'])
    expect(labels('ATs+')).toEqual(['AJs', 'AKs', 'AQs', 'ATs'])
    expect(labels('KTo+')).toEqual(['KJo', 'KQo', 'KTo'])
    expect(size('A9+')).toBe(5 * 16)
    expect(size('22+')).toBe(78)
  })
  it('expands dash ladders in either order', () => {
    expect(labels('22-44')).toEqual(['22', '33', '44'])
    expect(labels('A5s-A2s')).toEqual(['A2s', 'A3s', 'A4s', 'A5s'])
    expect(labels('K9o-KJo')).toEqual(['K9o', 'KJo', 'KTo'])
    expect(labels('T9s-76s')).toEqual(['76s', '87s', '98s', 'T9s'])
    expect(labels('J9o-75o')).toEqual(['75o', '86o', '97o', 'J9o', 'T8o'])
  })
  it('accepts exact combos, random and percentages', () => {
    expect(size('AhKh')).toBe(1)
    expect(size('AhKh, AhKh')).toBe(1)
    expect(size('random')).toBe(1326)
    expect(size('any')).toBe(1326)
    expect(size('*', 'shortdeck')).toBe(630)
  })
  it('applies weights, weight blocks and later-token precedence', () => {
    const r = parseRange('QQ+, AA:0.5, KK:25%')
    const aa = combosOfClass(12, 12, 'pair')[0]
    const kk = combosOfClass(11, 11, 'pair')[0]
    const qq = combosOfClass(10, 10, 'pair')[0]
    expect(r.combos.get(comboKey(...aa))).toBe(0.5)
    expect(r.combos.get(comboKey(...kk))).toBe(0.25)
    expect(r.combos.get(comboKey(...qq))).toBe(1)
    expect(rangeWeightTotal(r.combos)).toBe(3 + 1.5 + 6)

    const block = parseRange('[50]AA, KK[/50], QQ')
    expect(block.issues).toEqual([])
    expect(block.combos.get(comboKey(...aa))).toBe(0.5)
    expect(block.combos.get(comboKey(...kk))).toBe(0.5)
    expect(block.combos.get(comboKey(...qq))).toBe(1)
    expect(parseRange('[0.25] AKs [/0.25]').combos.size).toBe(4)
    expect(parseRange('AA, AA:0').combos.size).toBe(0)
  })
  it('reports bad tokens without dropping the good ones', () => {
    const r = parseRange('AA, XYZ, AAs, AKs-QTs, A2s-K2o, AhAh, KK:150%, ], QQ')
    expect(r.combos.size).toBe(12)
    expect(r.issues.map((i) => i.token)).toEqual(['XYZ', 'AAs', 'AKs-QTs', 'A2s-K2o', 'AhAh', 'KK:150%', ']'])
    expect(parseRange('[50] AA').issues.map((i) => i.message)).toContain('Unclosed weight block')
  })
  it('restricts short deck ranges to six and up', () => {
    expect(size('66+', 'shortdeck')).toBe(54)
    expect(parseRange('55', 'shortdeck').issues).toHaveLength(1)
    expect(parseRange('A5s', 'shortdeck').issues).toHaveLength(1)
    expect(parseRange('Ah5h', 'shortdeck').issues).toHaveLength(1)
    expect(size('A6s+', 'shortdeck')).toBe(4 * 8)
  })
})

describe('percent ranges', () => {
  it('ship generated orderings for every class', () => {
    expect(PREFLOP_EQUITY.holdem.vs1).toHaveLength(169)
    expect(PREFLOP_EQUITY.holdem.vs3).toHaveLength(169)
    expect(PREFLOP_EQUITY.shortdeck.vs1).toHaveLength(81)
    expect(PREFLOP_EQUITY.shortdeck.vs3).toHaveLength(81)
    expect(rankedClasses('holdem', 'vs1')[0].label).toBe('AA')
    expect(rankedClasses('holdem', 'vs3')[0].label).toBe('AA')
    const vs1 = PREFLOP_EQUITY.holdem.vs1
    expect(vs1[vs1.length - 1][0]).toBe('32o')
  })
  it('selects close to the requested share of combos', () => {
    for (const p of [1, 5, 12.5, 25, 50, 80]) {
      const combos = topPercentClasses('holdem', p).reduce((s, c) => s + combosOfClass(c.high, c.low, c.kind).length, 0)
      expect(Math.abs(combos / 1326 - p / 100)).toBeLessThanOrEqual(6 / 1326)
    }
    expect(size('100%')).toBe(1326)
    expect(size('0%')).toBe(0)
  })
  it('supports windows and differs by ordering', () => {
    const top = new Set(percentClasses('holdem', 0, 10).map((c) => c.label))
    const window = percentClasses('holdem', 10, 20).map((c) => c.label)
    expect(window.some((l) => top.has(l))).toBe(false)
    expect(size('10%-20%')).toBe(window.reduce((s, l) => s + combosOfClass(parseClassLabel(l)!.high, parseClassLabel(l)!.low, parseClassLabel(l)!.kind).length, 0))
    const vs1 = parseRange('20%', 'holdem', 'vs1').combos
    const vs3 = parseRange('20%', 'holdem', 'vs3').combos
    expect([...vs1.keys()].sort()).not.toEqual([...vs3.keys()].sort())
  })
})

describe('formatRange', () => {
  const roundTrip = (text: string) => {
    const combos = parseRange(text).combos
    const formatted = formatRange(combos)
    const again = parseRange(formatted).combos
    expect(again).toEqual(combos)
    return formatted
  }
  it('compresses to standard notation', () => {
    expect(roundTrip('QQ+, AKs, AKo')).toBe('QQ+, AKs, AKo')
    expect(roundTrip('22-55')).toBe('55-22')
    expect(roundTrip('ATs+')).toBe('ATs+')
    expect(roundTrip('A5s-A2s')).toBe('A5s-A2s')
    expect(roundTrip('random')).toBe('random')
    expect(formatRange(new Map())).toBe('')
  })
  it('round trips weights, partial classes and arbitrary mixes', () => {
    roundTrip('AA:0.5, KK, QQ:0.5, AhKh, AsKs:25%, T9s-65s, 76o')
    roundTrip('22+, A2+, K9s+, [33]JTo, T9o[/33]')
    roundTrip('15%')
    roundTrip('random:0.3')
  })
  it('measures class coverage for the grid', () => {
    const combos = parseRange('AhKh, AsKs:0.5').combos
    expect(classCoverage(combos, parseClassLabel('AKs')!)).toBeCloseTo(1.5 / 4, 12)
    expect(classCoverage(combos, parseClassLabel('AKo')!)).toBe(0)
    expect(formatCards(comboFromKey([...combos.keys()][0]))).toMatch(/^A[hs]K[hs]$/)
  })
})
