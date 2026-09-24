import type { BatchStatus, OrderStatus, PurchaseStatus, ReservationStatus } from "./types";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  abierto: { label: "En curso", tone: "warning" },
  listo: { label: "Listo", tone: "success" },
  cobrado: { label: "Cobrado", tone: "neutral" },
  cancelado: { label: "Anulado", tone: "danger" },
};

export const BATCH_STATUS: Record<BatchStatus, { label: string; tone: Tone }> = {
  borrador: { label: "Sin enviar", tone: "neutral" },
  pendiente: { label: "Pendiente en cocina", tone: "warning" },
  listo: { label: "Listo", tone: "success" },
};

export const PURCHASE_STATUS: Record<PurchaseStatus, { label: string; tone: Tone }> = {
  pendiente: { label: "Pendiente", tone: "warning" },
  confirmada: { label: "Confirmada", tone: "info" },
  parcial: { label: "Recibida parcial", tone: "violet" },
  recibida: { label: "Recibida", tone: "success" },
  cancelada: { label: "Cancelada", tone: "danger" },
};

export const RESERVATION_STATUS: Record<ReservationStatus, { label: string; tone: Tone }> = {
  confirmada: { label: "Confirmada", tone: "info" },
  sentada: { label: "En mesa", tone: "violet" },
  cumplida: { label: "Cumplida", tone: "success" },
  cancelada: { label: "Cancelada", tone: "neutral" },
  no_show: { label: "No-show", tone: "danger" },
};

export const DEPOSIT_STATUS = {
  cobrada: { label: "Seña cobrada", tone: "success" },
  aplicada: { label: "Seña aplicada", tone: "neutral" },
  devuelta: { label: "Seña devuelta", tone: "info" },
  perdida: { label: "Seña perdida", tone: "danger" },
} as const;
