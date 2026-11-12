// Validaciones compartidas entre el cliente y el servidor.

/** Teléfono: sólo dígitos, espacios, "+", "-" y paréntesis; entre 8 y 15 dígitos. */
export function isValidPhone(s: string) {
  const t = s.trim();
  if (!/^\+?[\d\s()-]+$/.test(t)) return false;
  const digits = t.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15;
}

export const PHONE_ERROR = "Teléfono inválido: use sólo números (8 a 15 dígitos), por ejemplo +54 385 112 2334";

/** CUIT: formato 30-12345678-9 (vacío = no informado). */
export const CUIT_REGEX = /^\d{2}-\d{8}-\d$/;
