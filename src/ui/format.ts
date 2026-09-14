import type { EquityResult } from '../engine/equity.ts'

export const Z95 = 1.959964

/** Decimal places the result can defend: exact gets two, Monte Carlo gets what its interval allows. */
export function decimalsFor(result: Pick<EquityResult, 'method'>, stdErr: number): number {
  if (result.method === 'exact') return 2
  const halfWidth = Z95 * stdErr * 100
  if (!(halfWidth > 0)) return 1
  // The last shown digit should sit at the scale of the interval: ±0.1 shows 41.4%, ±0.02 shows 41.43%.
  return Math.min(3, Math.max(0, Math.ceil(-Math.log10(halfWidth) - 0.3)))
}

export const pct = (x: number, decimals = 1): string => `${(x * 100).toFixed(decimals)}%`

/** "4.3 : 1" against, or "1 : 2.1" when a favourite. */
export function odds(p: number): string {
  if (p <= 0) return 'never'
  if (p >= 1) return 'always'
  const against = (1 - p) / p
  if (against >= 1) return `${against >= 10 ? against.toFixed(0) : against.toFixed(1)} : 1`
  const favour = 1 / against
  return `1 : ${favour >= 10 ? favour.toFixed(0) : favour.toFixed(1)}`
}

export const int = (n: number): string => Math.round(n).toLocaleString('en-US')

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)}K`
  return int(n)
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}
