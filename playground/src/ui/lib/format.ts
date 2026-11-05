/** Number, time and address formatting. Pure helpers, no engine access. */

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Base units (decimal string) to a grouped human amount: "250000000000" with 6 decimals -> "250,000". */
export function formatUnits(base: string | undefined, decimals: number, maxFraction = 6): string {
  if (base === undefined || base === '') return '0'
  let v: bigint
  try {
    v = BigInt(base)
  } catch {
    return base
  }
  const neg = v < 0n
  if (neg) v = -v
  const scale = 10n ** BigInt(decimals)
  const whole = v / scale
  let frac = decimals > 0 ? (v % scale).toString().padStart(decimals, '0') : ''
  frac = frac.slice(0, maxFraction).replace(/0+$/, '')
  const out = group(whole.toString()) + (frac ? '.' + frac : '')
  return (neg ? '-' : '') + out
}

/** A human amount typed by someone ("1200.5") with grouping for display. */
export function formatHuman(amount: string | number | undefined): string {
  if (amount === undefined || amount === '') return '0'
  const s = String(amount)
  const [w, f] = s.split('.')
  if (!/^\d+$/.test(w)) return s
  return group(w) + (f ? '.' + f : '')
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC'
})

export function formatTime(unix: number): string {
  return DATE.format(new Date(unix * 1000)).replace(',', '') + ' UTC'
}

const SHORT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC'
})

export function formatShortTime(unix: number): string {
  return SHORT.format(new Date(unix * 1000)).replace(',', '')
}

/** 3600 -> "1 hour", 5400 -> "1 h 30 min", 604800 -> "7 days". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return s === 1 ? '1 second' : `${s} seconds`
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) {
    const days = d === 1 ? '1 day' : `${d} days`
    return h > 0 ? `${days} ${h} h` : days
  }
  if (h > 0) {
    const hours = h === 1 ? '1 hour' : `${h} hours`
    return m > 0 ? `${h} h ${m} min` : hours
  }
  return `${m} min`
}

export function shortAddress(a: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function isAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a)
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return 'nobody'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
