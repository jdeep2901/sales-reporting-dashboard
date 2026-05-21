// formatCurrency: compact format per design system spec.
// <$1K → exact ("$850"), $1K–$999K → "$XXXK", $1M+ → "$X.XXM"
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs < 1_000) return `${sign}$${Math.round(abs)}`;
  if (abs < 1_000_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
}

// formatPercent: "42%" or "42.1%" when non-integer
export function formatPercent(value: number | null | undefined, decimals = 0): string {
  if (value == null || isNaN(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

// formatDelta: signed compact currency delta. "+$120K" / "-$30K"
export function formatDelta(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '—';
  const abs = formatCurrency(Math.abs(value));
  return value >= 0 ? `+${abs}` : `-${abs.replace('$', '$')}`;
}

// formatDate: "May 21" or "May 21, 2026" for cross-year dates
export function formatDate(iso: string | null | undefined, showYear = false): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });
}

// fiscalQuarter: returns e.g. "Q1 FY27" for a given date (FY = Apr–Mar)
export function fiscalQuarter(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return '—';
  const m = d.getMonth(); // 0-indexed
  const y = d.getFullYear();
  // Apr (3) = Q1, Jul (6) = Q2, Oct (9) = Q3, Jan (0) = Q4
  let q: number;
  let fy: number;
  if (m >= 3 && m <= 5) { q = 1; fy = y + 1; }
  else if (m >= 6 && m <= 8) { q = 2; fy = y + 1; }
  else if (m >= 9 && m <= 11) { q = 3; fy = y + 1; }
  else { q = 4; fy = y; } // Jan–Mar
  return `Q${q} FY${String(fy).slice(-2)}`;
}
