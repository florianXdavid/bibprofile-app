// Small display helpers shared across cards. Kept trivial and dependency-free.

// A fraction (0..1) as a rounded whole-number percent, or an em dash if absent.
export function pct(frac: number | null | undefined): string {
  return frac == null ? '—' : `${Math.round(frac * 100)}%`
}

export function plural(n: number, one: string, many = one + 's'): string {
  return n === 1 ? one : many
}
