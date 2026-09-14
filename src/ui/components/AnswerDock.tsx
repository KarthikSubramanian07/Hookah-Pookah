import { useEffect, useState } from 'react'
import type { EquityUpdate } from '../../worker/pool.ts'
import { pct, verdict } from '../format.ts'

interface Props {
  result: EquityUpdate | undefined
  players: number
  running: boolean
}

/** Small screens: keeps the answer in reach while the full panel is scrolled out of view. */
export function AnswerDock({ result, players, running }: Props) {
  const [answerVisible, setAnswerVisible] = useState(false)

  useEffect(() => {
    const target = document.querySelector('.answer')
    if (!target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setAnswerVisible(entry.isIntersecting), { threshold: 0.2 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const hero = result?.players[0]
  const v = hero ? verdict(hero.equity, players) : undefined
  return (
    <button
      type="button"
      className="answer-dock"
      data-hidden={answerVisible || !hero}
      aria-hidden={answerVisible || !hero}
      tabIndex={answerVisible || !hero ? -1 : 0}
      onClick={() => document.querySelector('.answer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
      <span className="answer-dock-label">Your chance to win</span>
      <span className="answer-dock-value" style={{ opacity: running ? 0.6 : 1 }}>
        {hero ? pct(hero.equity, 1) : ''}
      </span>
      {v && <span className={`verdict is-${v.tone}`}>{v.label}</span>}
      <span className="answer-dock-more">Details ↓</span>
    </button>
  )
}
