const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD_WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const SHORT_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** "$8,400.00" */
export const usd = (amount: number): string => USD.format(amount);

/** "$2,000" for whole dollars, "$23.40" otherwise. */
export const usdCompact = (amount: number): string => (Number.isInteger(amount) ? USD_WHOLE.format(amount) : USD.format(amount));

/** "+$1,650.00" or "−$23.40" */
export const signedUsd = (amount: number): string => `${amount < 0 ? "−" : "+"}${USD.format(Math.abs(amount))}`;

/** "2026-10-02" -> "Oct 2" */
export function shortDay(isoDay: string): string {
  const ms = Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? "" : SHORT_DAY.format(ms);
}

/** "6:42 PM" */
export const clock = (date: Date): string => CLOCK.format(date);

/** "just now", "5 min ago", "2 hr ago" */
export function ago(date: Date, now: number): string {
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)} d ago`;
}
