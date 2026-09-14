import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from './engine/cards.ts'
import { formatCard } from './engine/cards.ts'
import type { VariantId } from './engine/variants.ts'
import { VARIANTS, VARIANT_IDS, deckFor } from './engine/variants.ts'
import { parseQuickSpot } from './state/quickSpot.ts'
import { VARIANT_TITLES } from './state/seo.ts'
import { type Spot, compactBoard, needsAdvanced, playerLabel, usedCards } from './state/spot.ts'
import { VARIANT_PATHS, spotFromUrl, spotToUrl } from './state/url.ts'
import { About } from './ui/components/About.tsx'
import { BoardPanel } from './ui/components/BoardPanel.tsx'
import { CardPicker } from './ui/components/CardPicker.tsx'
import { HandChances } from './ui/components/HandChances.tsx'
import { NextCard } from './ui/components/NextCard.tsx'
import { PlayerRow } from './ui/components/PlayerRow.tsx'
import { PotOdds } from './ui/components/PotOdds.tsx'
import { Answer } from './ui/components/Answer.tsx'
import { AnswerDock } from './ui/components/AnswerDock.tsx'
import { useEquity, type Precision } from './ui/useEquity.ts'
import { type SlotRef, useSpot } from './ui/useSpot.ts'

interface OpenSlot {
  ref: SlotRef
  key: string
  el: HTMLElement
  label: string
}

const readLocation = (): Spot => spotFromUrl(window.location.pathname, window.location.search)

function cardAt(spot: Spot, ref: SlotRef): Card | null {
  if (ref.kind === 'player') return spot.players[ref.player]?.cards[ref.slot] ?? null
  if (ref.kind === 'board') return spot.board[ref.slot] ?? null
  return spot.dead[ref.slot] ?? null
}

/** Maps an owner label from usedCards back to the slot key that holds the card. */
function slotKeyFor(spot: Spot, card: Card): string | undefined {
  for (const p of spot.players) {
    const i = p.cards.indexOf(card)
    if (i >= 0 && p.mode === 'cards') return `p${p.id}-${i}`
  }
  const b = spot.board.indexOf(card)
  if (b >= 0) return `b-${b}`
  const d = spot.dead.indexOf(card)
  if (d >= 0) return `d-${d}`
  return undefined
}

export function App() {
  const { state, act } = useSpot(readLocation)
  const { spot } = state
  const info = VARIANTS[spot.variant]
  const [precision, setPrecision] = useState<Precision>('standard')
  const [open, setOpen] = useState<OpenSlot | null>(null)
  const [flash, setFlash] = useState<string>()
  const [focus, setFocus] = useState(0)
  const [quick, setQuick] = useState('')
  const [quickError, setQuickError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [advancedPref, setAdvancedPref] = useState(() => {
    try {
      return window.localStorage.getItem('hp-advanced') === '1'
    } catch {
      return false
    }
  })
  const setAdvanced = (on: boolean) => {
    setAdvancedPref(on)
    try {
      window.localStorage.setItem('hp-advanced', on ? '1' : '0')
    } catch {
      // Private browsing: the preference just lasts for this visit.
    }
  }
  const quickRef = useRef<HTMLInputElement>(null)

  const equity = useEquity(spot, precision)
  const used = useMemo(() => usedCards(spot), [spot])
  const blocked = useMemo(() => new Set(used.keys()), [used])
  const board = compactBoard(spot.board)
  const focusIndex = Math.min(focus, spot.players.length - 1)

  // Keep the address bar in sync; switching variants creates a history entry so Back works.
  const lastVariant = useRef(spot.variant)
  useEffect(() => {
    const url = spotToUrl(spot)
    if (url === window.location.pathname + window.location.search) return
    if (lastVariant.current !== spot.variant) {
      window.history.pushState(null, '', url)
      lastVariant.current = spot.variant
    } else {
      window.history.replaceState(null, '', url)
    }
  }, [spot])

  useEffect(() => {
    const onPop = () => {
      const next = readLocation()
      lastVariant.current = next.variant
      act({ type: 'replace', spot: next })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [act])

  useEffect(() => {
    document.title = VARIANT_TITLES[spot.variant]
  }, [spot.variant])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.closest('input, textarea, [contenteditable="true"]')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        act({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (e.key === '/' && !typing && !target.closest('[data-slot], .picker')) {
        e.preventDefault()
        if (!quickRef.current) {
          setAdvancedPref(true)
          requestAnimationFrame(() => quickRef.current?.focus())
        } else quickRef.current.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act])

  const flashOwner = useCallback(
    (card: Card, targetKey: string) => {
      const from = slotKeyFor(spot, card)
      if (from && from !== targetKey) {
        setFlash(from)
        setTimeout(() => setFlash(undefined), 700)
      }
    },
    [spot],
  )

  const setCard = useCallback(
    (ref: SlotRef, card: Card | null, key?: string) => {
      if (card !== null && key) flashOwner(card, key)
      act({ type: 'card', ref, card })
    },
    [act, flashOwner],
  )

  const onOpenSlot = useCallback((ref: SlotRef, key: string, el: HTMLElement, label: string) => {
    setOpen((cur) => (cur?.key === key ? null : { ref, key, el, label }))
  }, [])

  const advancePicker = (from: OpenSlot) => {
    requestAnimationFrame(() => {
      const all = [...document.querySelectorAll<HTMLElement>('[data-slot]')]
      const group = from.el.dataset.slotGroup
      const index = all.findIndex((el) => el.dataset.slot === from.key)
      const next = all.slice(index + 1).find((el) => el.dataset.slotGroup === group && el.dataset.empty === 'true')
      if (next) next.click()
      else {
        setOpen(null)
        from.el.focus()
      }
    })
  }

  const randomCard = (): Card | undefined => {
    const available = deckFor(spot.variant).filter((c) => !used.has(c))
    return available[Math.floor(Math.random() * available.length)]
  }

  const onQuick = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseQuickSpot(quick, spot)
    if (parsed.error) {
      setQuickError(parsed.error)
      return
    }
    setQuickError(undefined)
    act({ type: 'replace', spot: parsed.spot! })
  }

  const share = async () => {
    const url = window.location.origin + spotToUrl(spot)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  const switchVariant = (variant: VariantId) => {
    setOpen(null)
    setFocus(0)
    act({ type: 'variant', variant })
  }

  const advanced = advancedPref || needsAdvanced(spot)
  const stale = equity.status === 'running'
  const result = equity.result && equity.result.players.length === spot.players.length ? equity.result : undefined
  const playerProblem = (i: number) => equity.compiled.problems.find((p) => p.where === i)?.message
  const blocker = equity.compiled.problems[0]
    ? equity.compiled.problems[0].where === 'board'
      ? 'Fill the board from left to right: flop first, then turn, then river.'
      : `${typeof equity.compiled.problems[0].where === 'number' ? playerLabel(equity.compiled.problems[0].where) : 'This hand'}: ${equity.compiled.problems[0].message.toLowerCase()}.`
    : undefined

  const renderPlayer = (i: number) => {
    const player = spot.players[i]
    return (
      <PlayerRow
        key={player.id}
        index={i}
        count={spot.players.length}
        player={player}
        variant={spot.variant}
        shortDeckRules={spot.shortDeckRules}
        ranking={spot.ranking}
        board={board}
        blocked={blocked}
        result={result}
        stale={stale}
        advanced={advanced}
        problem={playerProblem(i)}
        issues={equity.compiled.rangeIssues.get(i)}
        activeSlot={open?.key}
        flashSlot={flash}
        onOpenSlot={onOpenSlot}
        onCard={(ref, card) => setCard(ref, card, ref.kind === 'player' ? `p${player.id}-${ref.slot}` : undefined)}
        onMode={(mode) => act({ type: 'mode', player: i, mode })}
        onRange={(text, typing) => act({ type: 'range', player: i, text, typing })}
        onRanking={(ranking) => act({ type: 'ranking', ranking })}
        onRemove={() => act({ type: 'removePlayer', player: i })}
        onMove={(delta) => act({ type: 'movePlayer', player: i, delta })}
        onClear={() => act({ type: 'clearPlayer', player: i })}
        onAdvanced={() => setAdvanced(true)}
      />
    )
  }
  const boardProblem = equity.compiled.problems.find((p) => p.where === 'board')?.message

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Hookah Pookah home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <path d="M16 3c3 3 3 6 0 9s-3 6 0 9" fill="none" stroke="var(--cobalt)" strokeWidth="2" strokeLinecap="round" opacity=".8" />
              <rect x="7" y="20" width="18" height="9" rx="4.5" fill="var(--ember)" />
              <circle cx="16" cy="24.5" r="2" fill="var(--bg)" />
            </svg>
          </span>
          <span className="brand-name">Hookah Pookah</span>
        </a>
        <nav className="variants" aria-label="Game">
          {VARIANT_IDS.map((v) => (
            <a
              key={v}
              href={VARIANT_PATHS[v]}
              className="variant"
              aria-current={spot.variant === v ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return
                e.preventDefault()
                switchVariant(v)
              }}
            >
              {VARIANTS[v].shortName}
            </a>
          ))}
        </nav>
        <div className="topbar-actions">
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Undo" title="Undo (Cmd Z)" disabled={!state.past.length} onClick={() => act({ type: 'undo' })}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M7.5 5 3.5 9l4 4M4 9h7.5a5 5 0 0 1 0 10H9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Redo" title="Redo (Shift Cmd Z)" disabled={!state.future.length} onClick={() => act({ type: 'redo' })}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="m12.5 5 4 4-4 4M16 9H8.5a5 5 0 0 0 0 10H11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="btn" onClick={share}>
            {copied ? 'Link copied' : 'Share spot'}
          </button>
        </div>
      </header>

      <main className={`layout${advanced ? ' is-advanced' : ' is-simple'}`}>
        <div className="table-col">
          <div className="intro">
            <h1 className="headline">What are the chances?</h1>
            <p className="headline-sub">Pick your cards, add opponents, and see your odds instantly.</p>
            <div className="intro-controls">
              <label className="switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={advanced}
                  disabled={needsAdvanced(spot) && !advancedPref}
                  onChange={(e) => setAdvanced(e.target.checked)}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
                <span className="switch-label">
                  Advanced
                  <span className="switch-hint">{advanced ? 'ranges, dead cards, precision' : 'ranges, dead cards and more'}</span>
                </span>
              </label>
              {spot.variant === 'shortdeck' && (
                <div className="segmented" role="group" aria-label="Short deck rules">
                  <button type="button" aria-pressed={spot.shortDeckRules === 'triton'} onClick={() => act({ type: 'rules', rules: 'triton' })} title="Three of a kind beats a straight">
                    Triton rules
                  </button>
                  <button type="button" aria-pressed={spot.shortDeckRules === 'classic'} onClick={() => act({ type: 'rules', rules: 'classic' })} title="Straight beats three of a kind">
                    Classic rules
                  </button>
                </div>
              )}
            </div>
            {advanced && (
              <form className="quick" onSubmit={onQuick} role="search">
                <label htmlFor="quick" className="visually-hidden">
                  Type a whole spot
                </label>
                <input
                  id="quick"
                  ref={quickRef}
                  className="input mono quick-input"
                  placeholder={info.supportsRanges ? 'AhKh vs QQ+, AKs vs random on Ks7h2d' : `${spot.variant === 'omaha5' ? 'AsAhKsKhQd' : 'AsAhKsKh'} vs random on Kd7h6h`}
                  value={quick}
                  aria-invalid={quickError ? 'true' : undefined}
                  aria-describedby="quick-help"
                  onChange={(e) => {
                    setQuick(e.target.value)
                    setQuickError(undefined)
                  }}
                />
                <button type="submit" className="btn btn-primary">
                  Load
                </button>
                <p id="quick-help" className={`quick-help${quickError ? ' is-error' : ''}`}>
                  {quickError ?? (
                    <>
                      Type a whole spot: players split by <span className="mono">vs</span>, board after <span className="mono">on</span>, dead cards after <span className="mono">dead</span>. Press <kbd>/</kbd> to jump here.
                    </>
                  )}
                </p>
              </form>
            )}
          </div>

          <section className="step" aria-labelledby="step-you">
            <div className="section-head">
              <h2 id="step-you" className="section-title step-title">
                <span className="step-number mono" aria-hidden="true">
                  1
                </span>
                Your hand
              </h2>
            </div>
            <ol className="player-list">{renderPlayer(0)}</ol>
          </section>

          <section className="step" aria-labelledby="step-opponents">
            <div className="section-head">
              <h2 id="step-opponents" className="section-title step-title">
                <span className="step-number mono" aria-hidden="true">
                  2
                </span>
                Opponents <span className="section-count mono">{spot.players.length - 1}</span>
              </h2>
              <div className="section-actions">
                <button type="button" className="btn btn-sm" disabled={spot.players.length >= info.maxPlayers} onClick={() => act({ type: 'addPlayer' })}>
                  Add opponent
                </button>
              </div>
            </div>
            {spot.players.length > 1 ? (
              <ol className="player-list">{spot.players.slice(1).map((_, i) => renderPlayer(i + 1))}</ol>
            ) : (
              <p className="section-lede">No opponents yet. Add one to see who is ahead.</p>
            )}
            {spot.players.length > 1 && <p className="section-foot">Leave an opponent's cards empty if you don't know them. They are dealt at random.</p>}
          </section>

          <BoardPanel
            step={3}
            advanced={advanced}
            variant={spot.variant}
            board={spot.board}
            dead={spot.dead}
            activeSlot={open?.key}
            flashSlot={flash}
            problem={boardProblem}
            onOpenSlot={onOpenSlot}
            onCard={(ref, card) => setCard(ref, card, ref.kind === 'board' ? `b-${ref.slot}` : `d-${ref.slot}`)}
            onDeal={(upTo) => act({ type: 'dealBoard', upTo, random: Math.random })}
            onClearBoard={() => act({ type: 'clearBoard' })}
            onClearDead={() => act({ type: 'clearDead' })}
          />

          <p className="reset-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => act({ type: 'clearAll' })}>
              Start over
            </button>
          </p>
        </div>

        <div className="readout-col">
          <Answer equity={equity} players={spot.players} advanced={advanced} precision={precision} onPrecision={setPrecision} blocker={blocker} />
          <HandChances variant={spot.variant} shortDeckRules={spot.shortDeckRules} players={spot.players} result={result} advanced={advanced} focus={focusIndex} onFocus={setFocus} />
          <NextCard
            variant={spot.variant}
            boardLength={board.length}
            players={spot.players}
            equity={equity}
            used={used}
            advanced={advanced}
            focus={focusIndex}
            onFocus={setFocus}
            onDeal={(card) => {
              const slot = spot.board.indexOf(null)
              if (slot >= 0) act({ type: 'card', ref: { kind: 'board', slot }, card })
            }}
          />
          <PotOdds result={result} heroLabel={playerLabel(0)} />
        </div>
      </main>

      <AnswerDock result={result} players={spot.players.length} running={stale} />
      <About />

      {open && (
        <CardPicker
          key={open.key}
          anchor={open.el}
          title={open.label}
          current={cardAt(spot, open.ref)}
          minRank={info.minRank}
          used={used}
          onPick={(card) => {
            setCard(open.ref, card, open.key)
            advancePicker(open)
          }}
          onClear={() => setCard(open.ref, null)}
          onRandom={() => {
            const card = randomCard()
            if (card !== undefined) {
              setCard(open.ref, card, open.key)
              advancePicker(open)
            }
          }}
          onClose={() => setOpen(null)}
        />
      )}
      <p className="visually-hidden" aria-live="polite">
        {open ? `Picking ${open.label}. Current ${cardAt(spot, open.ref) === null ? 'empty' : formatCard(cardAt(spot, open.ref)!)}` : ''}
      </p>
    </div>
  )
}
