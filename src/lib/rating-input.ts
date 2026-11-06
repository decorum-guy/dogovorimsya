export function readRating(input: string): number | null {
  const text = input.trim().replace(',', '.');
  if (!/^(?:\d(?:\.\d?)?|\.\d)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 5 ? Math.round(value * 10) : null;
}
