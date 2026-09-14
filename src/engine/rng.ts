/**
 * xoshiro128** by Blackman and Vigna: fast, 128 bits of state, passes BigCrush.
 * Seeded through splitmix32 so any 32-bit seed yields a well mixed state.
 */
export class Rng {
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: number = (Math.random() * 2 ** 32) >>> 0) {
    let s = seed >>> 0
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
      return (z ^ (z >>> 16)) >>> 0
    }
    this.a = next()
    this.b = next()
    this.c = next()
    this.d = next()
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0
    const t = this.b << 11
    this.c ^= this.a
    this.d ^= this.b
    this.b ^= this.c
    this.a ^= this.d
    this.c ^= t
    this.d = rotl(this.d, 11)
    return result
  }

  /** Uniform float in [0, 1) with 32 bits of resolution. */
  nextFloat(): number {
    return this.nextU32() / 4294967296
  }

  /** Exactly unbiased integer in [0, n) by masked rejection. 1 <= n <= 2^31. */
  nextInt(n: number): number {
    const mask = n <= 1 ? 0 : 0xffffffff >>> Math.clz32(n - 1)
    for (;;) {
      const x = (this.nextU32() & mask) >>> 0
      if (x < n) return x
    }
  }
}

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k))
