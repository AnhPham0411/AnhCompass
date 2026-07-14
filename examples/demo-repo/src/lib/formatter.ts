// src/lib/formatter.ts — DRIFT: uses console.log (violates no-console-in-lib)
export function formatAmount(amount: number, currency: string): string {
  console.log(`Formatting ${amount} ${currency}`); // ← VIOLATION
  return `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
