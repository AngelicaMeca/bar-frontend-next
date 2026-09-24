// Formatos localizados para Argentina (RNF-14).
export const TZ = "America/Argentina/Buenos_Aires";
const LOCALE = "es-AR";

const money = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const moneyShort = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

export const fmtMoney = (n: number) => money.format(Number.isFinite(n) ? n : 0);
export const fmtMoneyShort = (n: number) => moneyShort.format(Number.isFinite(n) ? n : 0);
export const fmtNum = (n: number) => num.format(Number.isFinite(n) ? n : 0);

export function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(LOCALE, { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}
export function fmtTime(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(LOCALE, { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}
export function fmtDateTime(iso?: string) {
  if (!iso) return "—";
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}
export function fmtWeekday(iso: string) {
  return new Date(iso).toLocaleDateString(LOCALE, { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
}

/** Clave de día YYYY-MM-DD en hora argentina. */
export function dayKey(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Inicio/fin de un día YYYY-MM-DD en hora argentina (UTC-3 fijo). */
export const dayStart = (key: string) => new Date(`${key}T00:00:00.000-03:00`);
export const dayEnd = (key: string) => new Date(`${key}T23:59:59.999-03:00`);

export function addDays(key: string, days: number) {
  const d = dayStart(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dayKey(d);
}

/** Lunes de la semana (clave) de un día. */
export function weekStart(key: string) {
  const d = new Date(`${key}T12:00:00.000-03:00`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(key, -dow);
}

export function minutesBetween(a?: string, b?: string) {
  if (!a || !b) return 0;
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

export function fmtDuration(min: number) {
  if (!Number.isFinite(min) || min <= 0) return "0 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h} h ${m.toString().padStart(2, "0")} min`;
}

/** Valor para <input type="datetime-local"> a partir de un ISO (hora local del navegador). */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
