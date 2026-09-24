// Búsqueda rápida de productos por nombre, alias, abreviatura o coincidencia parcial (RF-PED-03).

export function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Devuelve un puntaje (mayor = mejor) o 0 si no coincide. */
export function matchScore(query: string, name: string, aliases: string[] = []): number {
  const q = normalize(query);
  if (!q) return 1;
  const n = normalize(name);
  const words = n.split(/\s+/);
  const al = aliases.map(normalize);
  if (n === q || al.includes(q)) return 100;
  if (n.startsWith(q)) return 80;
  if (al.some((a) => a.startsWith(q))) return 75;
  if (words.some((w) => w.startsWith(q))) return 60;
  if (n.includes(q)) return 50;
  if (al.some((a) => a.includes(q))) return 45;
  // Abreviatura por iniciales ("cq" -> "Cerveza Quilmes") o por prefijos de palabras ("mil nap" -> "Milanesa Napolitana")
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 40;
  if (q.length >= 2 && words.length >= q.length && q.split("").every((c, i) => words[i]?.startsWith(c))) return 30;
  // Subsecuencia de letras ("mlns" -> "milanesa")
  let i = 0;
  for (const c of n) if (c === q[i]) i++;
  if (q.length >= 3 && i === q.length) return 15;
  return 0;
}

export function searchItems<T>(items: T[], query: string, get: (t: T) => { name: string; aliases?: string[] }): T[] {
  if (!normalize(query)) return items;
  return items
    .map((t) => ({ t, s: matchScore(query, get(t).name, get(t).aliases) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}
