export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Normalize season label to YYYY-YY (e.g. 2009 → 2009-10). */
export function normalizeSeasonLabel(season: string): string | null {
  const trimmed = season.trim();
  const rangeMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (rangeMatch) return trimmed;

  const singleMatch = /^(\d{4})$/.exec(trimmed);
  if (singleMatch) {
    const start = Number.parseInt(singleMatch[1], 10);
    const end = start + 1;
    return `${start}-${String(end).slice(-2)}`;
  }

  return null;
}

export function seasonLabelToEndYear(label: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!match) return new Date().getFullYear();
  const century = match[1].slice(0, 2);
  return Number.parseInt(`${century}${match[2]}`, 10);
}
