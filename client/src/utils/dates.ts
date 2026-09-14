// <input type="datetime-local"> works in *local* time without a zone, while
// the API stores ISO UTC strings. Slicing the ISO string shifts the value by
// the UTC offset, so convert explicitly both ways.
export function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalDateTimeInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Sprint/version dates are stored as UTC midnight: format them in UTC so the
// calendar day never shifts with the viewer's timezone.
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Whole days from today (local) to the given UTC calendar day; negative when past.
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(toDateInput(iso) + 'T00:00:00');
  const today = new Date(todayInput() + 'T00:00:00');
  return daysBetween(today, target);
}
