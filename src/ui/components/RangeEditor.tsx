import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from '../../engine/cards.ts'
import type { ComboBreakdown } from '../../engine/equity.ts'
import type { RankingId } from '../../engine/preflopRanking.ts'
import {
  type HandClass,
  type RangeIssue,
  type RangeMap,
  classCoverage,
  classGrid,
  classOfCombo,
  combosOfClass,
  comboKey,
  formatRange,
  parseRange,
  rangeWeightTotal,
  totalCombos,
} from '../../engine/ranges.ts'
import type { VariantId } from '../../engine/variants.ts'
import { heat } from '../dom.ts'
import { PlayingCard } from './PlayingCard.tsx'

interface Props {
  variant: VariantId
  text: string
  ranking: RankingId
  issues: RangeIssue[] | undefined
  /** Cards already placed on the table, which block combos. */
  blocked: Set<Card>
  /** Per combo breakdown for this player from the latest result, if any. */
  breakdown: ComboBreakdown[] | undefined
  playerIndex: number
  onText: (text: string) => void
  onRanking: (ranking: RankingId) => void
}

const BRUSHES = [1, 0.75, 0.5, 0.25]

const PRESETS: { label: string; text: string }[] = [
  { label: 'Top 5%', text: '5%' },
  { label: '10%', text: '10%' },
  { label: '20%', text: '20%' },
  { label: '35%', text: '35%' },
  { label: 'Pairs', text: '22+' },
  { label: 'Broadway', text: 'TT+, ATs+, KTs+, QTs+, JTs, ATo+, KTo+, QTo+, JTo' },
  { label: 'Suited connectors', text: 'T9s-54s' },
  { label: 'Any two', text: 'random' },
]

type Aggregate = { equity: number; probability: number }

function aggregateByClass(breakdown: ComboBreakdown[] | undefined, player: number): Map<string, Aggregate> {
  const out = new Map<string, Aggregate>()
  if (!breakdown) return out
  for (const combo of breakdown) {
    if (combo.probability <= 0) continue
    const label = classOfCombo(combo.cards[0], combo.cards[1]).label
    const prev = out.get(label) ?? { equity: 0, probability: 0 }
    prev.equity += combo.equity[player] * combo.probability
    prev.probability += combo.probability
    out.set(label, prev)
  }
  for (const agg of out.values()) agg.equity /= agg.probability
  return out
}

export function RangeEditor({ variant, text, ranking, issues, blocked, breakdown, playerIndex, onText, onRanking }: Props) {
  const grid = useMemo(() => classGrid(variant), [variant])
  const parsed = useMemo(() => parseRange(text, variant, ranking).combos, [text, variant, ranking])
  const [brush, setBrush] = useState(1)
  const [view, setView] = useState<'paint' | 'equity'>('paint')
  const [focusCell, setFocusCell] = useState<[number, number]>([0, 0])
  const [suitsFor, setSuitsFor] = useState<HandClass | null>(null)
  const [percent, setPercent] = useState<[number, number]>([0, 20])
  const drag = useRef<{ mode: 'paint' | 'erase'; combos: RangeMap; seen: Set<string> } | null>(null)
  const [dragCombos, setDragCombos] = useState<RangeMap | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const combos = dragCombos ?? parsed
  const byClass = useMemo(() => aggregateByClass(breakdown, playerIndex), [breakdown, playerIndex])
  const weighted = rangeWeightTotal(combos)
  const total = totalCombos(variant)
  const live = useMemo(() => {
    let sum = 0
    for (const [key, w] of combos) if (!blocked.has(Math.floor(key / 52)) && !blocked.has(key % 52)) sum += w
    return sum
  }, [combos, blocked])

  const setClass = (map: RangeMap, cls: HandClass, weight: number) => {
    for (const [a, b] of combosOfClass(cls.high, cls.low, cls.kind)) {
      if (weight > 0) map.set(comboKey(a, b), weight)
      else map.delete(comboKey(a, b))
    }
  }

  const commit = (map: RangeMap) => onText(formatRange(map, variant))

  const cellAt = (x: number, y: number): HandClass | undefined => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-class]')
    if (!el || !gridRef.current?.contains(el)) return undefined
    const [r, c] = el.dataset.class!.split(',').map(Number)
    return grid[r][c]
  }

  const applyDrag = (cls: HandClass) => {
    const d = drag.current
    if (!d || d.seen.has(cls.label)) return
    d.seen.add(cls.label)
    setClass(d.combos, cls, d.mode === 'paint' ? brush : 0)
    setDragCombos(new Map(d.combos))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || view !== 'paint') return
    const cls = cellAt(e.clientX, e.clientY)
    if (!cls) return
    e.preventDefault()
    gridRef.current?.setPointerCapture(e.pointerId)
    const coverage = classCoverage(parsed, cls)
    const list = combosOfClass(cls.high, cls.low, cls.kind)
    const atBrush = list.every(([a, b]) => parsed.get(comboKey(a, b)) === brush)
    drag.current = { mode: atBrush && coverage > 0 ? 'erase' : 'paint', combos: new Map(parsed), seen: new Set() }
    applyDrag(cls)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    // Coalesced events keep fast drags from skipping cells.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events) {
      const cls = cellAt(ev.clientX, ev.clientY)
      if (cls) applyDrag(cls)
    }
  }

  const endDrag = () => {
    if (!drag.current) return
    const map = drag.current.combos
    drag.current = null
    setDragCombos(null)
    commit(map)
  }

  const toggleClass = (cls: HandClass) => {
    const map = new Map(parsed)
    const list = combosOfClass(cls.high, cls.low, cls.kind)
    const atBrush = list.every(([a, b]) => parsed.get(comboKey(a, b)) === brush)
    setClass(map, cls, atBrush ? 0 : brush)
    commit(map)
  }

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const [r, c] = focusCell
    const size = grid.length
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[e.key]) {
      e.preventDefault()
      const nr = Math.max(0, Math.min(size - 1, r + moves[e.key][0]))
      const nc = Math.max(0, Math.min(size - 1, c + moves[e.key][1]))
      setFocusCell([nr, nc])
      gridRef.current?.querySelector<HTMLElement>(`[data-class="${nr},${nc}"]`)?.focus()
    } else if ((e.key === ' ' || e.key === 'Enter') && view === 'paint') {
      e.preventDefault()
      toggleClass(grid[r][c])
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault()
      setSuitsFor(grid[r][c])
    }
  }

  const applyPercent = (from: number, to: number) => {
    setPercent([from, to])
    onText(from <= 0 ? `${to}%` : `${from}%-${to}%`)
  }

  return (
    <div className="range-editor">
      <div className="range-text">
        <label className="visually-hidden" htmlFor={`range-${playerIndex}`}>
          Range notation
        </label>
        <textarea
          id={`range-${playerIndex}`}
          className="input mono range-input"
          rows={2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="QQ+, AKs, A5s-A2s, KQo:0.5, 15%"
          value={text}
          aria-invalid={issues && issues.length > 0 ? 'true' : undefined}
          aria-describedby={`range-help-${playerIndex}`}
          onChange={(e) => onText(e.target.value)}
        />
        <div id={`range-help-${playerIndex}`} className="range-meta">
          <span className="mono">
            {weighted % 1 === 0 ? weighted : weighted.toFixed(1)} combos
          </span>
          <span className="range-share mono">{((weighted / total) * 100).toFixed(1)}% of hands</span>
          {live !== weighted && <span className="range-live mono">{live % 1 === 0 ? live : live.toFixed(1)} live after card removal</span>}
          {issues?.map((issue) => (
            <span key={issue.token + issue.message} className="range-issue" title={issue.message}>
              <span className="mono">{issue.token}</span> {issue.message}
            </span>
          ))}
        </div>
      </div>

      <div className="range-tools">
        <div className="segmented" role="group" aria-label="Grid view">
          <button type="button" aria-pressed={view === 'paint'} onClick={() => setView('paint')}>
            Paint
          </button>
          <button type="button" aria-pressed={view === 'equity'} onClick={() => setView('equity')} disabled={!byClass.size} title={byClass.size ? undefined : 'Available once results are in'}>
            Equity by hand
          </button>
        </div>
        {view === 'paint' && (
          <div className="brushes" role="group" aria-label="Brush weight">
            {BRUSHES.map((w) => (
              <button key={w} type="button" className="chip" aria-pressed={brush === w} onClick={() => setBrush(w)}>
                <span className="brush-swatch" style={{ '--w': w } as React.CSSProperties} aria-hidden="true" />
                {w * 100}%
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={gridRef}
        className={`range-grid view-${view}`}
        role="grid"
        aria-label="Starting hand grid. Arrow keys move, Space toggles, S opens suits."
        style={{ gridTemplateColumns: `repeat(${grid.length}, 1fr)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onGridKeyDown}
        onContextMenu={(e) => {
          const cls = cellAt(e.clientX, e.clientY)
          if (cls) {
            e.preventDefault()
            setSuitsFor(cls)
          }
        }}
      >
        {grid.map((row, r) => (
          <div key={r} role="row" className="range-row">
            {row.map((cls, c) => {
              const coverage = classCoverage(combos, cls)
              const agg = byClass.get(cls.label)
              const isFocus = focusCell[0] === r && focusCell[1] === c
              const style =
                view === 'equity'
                  ? ({ '--cell-bg': agg ? heat(agg.equity) : 'transparent' } as React.CSSProperties)
                  : ({ '--fill': coverage } as React.CSSProperties)
              return (
                <button
                  key={cls.label}
                  type="button"
                  role="gridcell"
                  tabIndex={isFocus ? 0 : -1}
                  data-class={`${r},${c}`}
                  data-kind={cls.kind}
                  data-on={coverage > 0}
                  className="range-cell"
                  style={style}
                  aria-label={`${cls.label}, ${combosOfClass(cls.high, cls.low, cls.kind).length} combos, ${Math.round(coverage * 100)}% selected${agg ? `, equity ${(agg.equity * 100).toFixed(1)}%` : ''}`}
                  aria-selected={coverage > 0}
                  onFocus={() => setFocusCell([r, c])}
                  title={agg ? `${cls.label}: ${(agg.equity * 100).toFixed(1)}% equity, ${(agg.probability * 100).toFixed(1)}% of range` : cls.label}
                >
                  <span className="range-cell-label">{cls.label}</span>
                  {view === 'equity' && agg && <span className="range-cell-eq mono">{Math.round(agg.equity * 100)}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className="range-percent">
        <div className="range-percent-head">
          <span className="label">Top hands by preflop equity</span>
          <div className="segmented" role="group" aria-label="Hand ordering">
            <button type="button" aria-pressed={ranking === 'vs1'} onClick={() => onRanking('vs1')} title="Equity against one random hand">
              vs 1
            </button>
            <button type="button" aria-pressed={ranking === 'vs3'} onClick={() => onRanking('vs3')} title="Equity against three random hands (PokerStove order)">
              vs 3
            </button>
          </div>
        </div>
        <div className="dual-slider">
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={percent[0]}
            aria-label="Range starts at percent"
            onChange={(e) => applyPercent(Math.min(Number(e.target.value), percent[1]), percent[1])}
          />
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={percent[1]}
            aria-label="Range ends at percent"
            onChange={(e) => applyPercent(percent[0], Math.max(Number(e.target.value), percent[0]))}
          />
          <span className="dual-slider-fill" style={{ left: `${percent[0]}%`, right: `${100 - percent[1]}%` }} aria-hidden="true" />
        </div>
        <div className="range-percent-values mono">
          <span>{percent[0]}%</span>
          <span>{percent[1]}%</span>
        </div>
      </div>

      <div className="range-presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="chip" onClick={() => onText(p.text)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => onText('')}>
          Clear
        </button>
      </div>

      {suitsFor && (
        <SuitCombos
          cls={suitsFor}
          combos={parsed}
          blocked={blocked}
          brush={brush}
          onChange={(map) => commit(map)}
          onClose={() => setSuitsFor(null)}
        />
      )}
    </div>
  )
}

function SuitCombos({
  cls,
  combos,
  blocked,
  brush,
  onChange,
  onClose,
}: {
  cls: HandClass
  combos: RangeMap
  blocked: Set<Card>
  brush: number
  onChange: (map: RangeMap) => void
  onClose: () => void
}) {
  const list = combosOfClass(cls.high, cls.low, cls.kind)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
  }, [cls])
  return (
    <div className="suit-combos" ref={ref} role="dialog" aria-label={`${cls.label} combos`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="suit-combos-head">
        <span>
          <strong>{cls.label}</strong> <span className="label">pick individual combos</span>
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="suit-combos-list">
        {list.map(([a, b]) => {
          const key = comboKey(a, b)
          const weight = combos.get(key) ?? 0
          const isBlocked = blocked.has(a) || blocked.has(b)
          return (
            <button
              key={key}
              type="button"
              className="suit-combo"
              aria-pressed={weight > 0}
              data-blocked={isBlocked}
              title={isBlocked ? 'Blocked by a card on the table' : undefined}
              onClick={() => {
                const map = new Map(combos)
                if (weight > 0) map.delete(key)
                else map.set(key, brush)
                onChange(map)
              }}
            >
              <PlayingCard card={a} size="sm" />
              <PlayingCard card={b} size="sm" />
              {weight > 0 && weight < 1 && <span className="suit-combo-w mono">{Math.round(weight * 100)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
