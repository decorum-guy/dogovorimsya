export const journalTimeZone = 'Europe/Moscow';
const calendar = new Intl.DateTimeFormat('en-GB', {
  timeZone: journalTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
function calendarDay(date: Date) {
  const parts = Object.fromEntries(calendar.formatToParts(date).map(part => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000;
}
// Calendar days, inclusive: registration day is day one, in the pair's timezone.
export function daysInJournal(startedAt: string | null, now = new Date()): number | null {
  if (!startedAt) return null;
  const started = new Date(startedAt);
  if (!Number.isFinite(started.getTime()) || !Number.isFinite(now.getTime())) return null;
  return Math.max(1, calendarDay(now) - calendarDay(started) + 1);
}
export function plural(count: number, words: [string, string, string]) {
  const lastTwo = Math.abs(count) % 100, last = lastTwo % 10;
  return words[lastTwo >= 11 && lastTwo <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
}
