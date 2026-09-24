import type { TableShape } from "./types";

// Dimensiones lógicas del plano del salón. Se escala al ancho disponible en pantalla.
export const PLAN_W = 1200;
export const PLAN_H = 760;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tableSize(shape: TableShape, capacity: number): { w: number; h: number } {
  const c = Math.max(1, Math.min(capacity, 12));
  if (shape === "rectangular") return { w: Math.min(100 + Math.max(0, c - 4) * 14, 200), h: 68 };
  const s = 62 + Math.min(c, 8) * 4;
  return { w: s, h: s };
}

export function clampToPlan(x: number, y: number, w: number, h: number) {
  return {
    x: Math.round(Math.max(0, Math.min(PLAN_W - w, x))),
    y: Math.round(Math.max(0, Math.min(PLAN_H - h, y))),
  };
}

const overlap1d = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1);

/**
 * Busca una mesa cercana (dentro del umbral) y devuelve la posición "pegada" a ella (RF-MSA-10, RF-MSA-15).
 */
export function findSnap<T extends Rect & { id: string }>(
  moving: Rect,
  others: T[],
  threshold: number,
): { x: number; y: number; target: T } | null {
  let best: { x: number; y: number; target: T; dist: number } | null = null;
  const minOverlap = 12;
  for (const o of others) {
    const ovX = overlap1d(moving.x, moving.x + moving.w, o.x, o.x + o.w);
    const ovY = overlap1d(moving.y, moving.y + moving.h, o.y, o.y + o.h);
    const gapX = Math.max(o.x - (moving.x + moving.w), moving.x - (o.x + o.w), 0);
    const gapY = Math.max(o.y - (moving.y + moving.h), moving.y - (o.y + o.h), 0);
    const intersects = ovX > 0 && ovY > 0;
    const candidates: { x: number; y: number }[] = [];

    // Adyacencia lateral (izquierda/derecha)
    if (ovY > -threshold && (gapX <= threshold || intersects)) {
      let y = Math.abs(moving.y - o.y) <= threshold ? o.y : moving.y;
      y = Math.max(o.y - moving.h + minOverlap, Math.min(o.y + o.h - minOverlap, y));
      candidates.push({ x: o.x - moving.w, y }, { x: o.x + o.w, y });
    }
    // Adyacencia vertical (arriba/abajo)
    if (ovX > -threshold && (gapY <= threshold || intersects)) {
      let x = Math.abs(moving.x - o.x) <= threshold ? o.x : moving.x;
      x = Math.max(o.x - moving.w + minOverlap, Math.min(o.x + o.w - minOverlap, x));
      candidates.push({ x, y: o.y - moving.h }, { x, y: o.y + o.h });
    }
    for (const c of candidates) {
      const dist = Math.hypot(c.x - moving.x, c.y - moving.y);
      if (dist <= threshold * 2 + (intersects ? Math.max(moving.w, moving.h) : 0) && (!best || dist < best.dist)) {
        best = { ...c, target: o, dist };
      }
    }
  }
  return best ? { x: best.x, y: best.y, target: best.target } : null;
}

export function boundingBox(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}
