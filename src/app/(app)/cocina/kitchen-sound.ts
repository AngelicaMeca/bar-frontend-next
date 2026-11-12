"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Alertas sonoras de la cocina (RF-COC-06). Se generan con la Web Audio API: no usan archivos ni servicios externos.
// Los navegadores sólo permiten audio después de una interacción del usuario; por eso el primer toque/clic
// en la página "desbloquea" el sonido.

const STORAGE_KEY = "cocina-sonido";

type Kind = "new" | "late";

// [frecuencia Hz, duración s, pausa s]
const PATTERNS: Record<Kind, [number, number, number][]> = {
  new: [
    [880, 0.16, 0.06],
    [1175, 0.26, 0],
  ],
  late: [
    [740, 0.2, 0.08],
    [740, 0.2, 0.08],
    [740, 0.2, 0.08],
    [988, 0.45, 0],
  ],
};

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function useKitchenSound() {
  const [enabled, setEnabledState] = useState(true);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Se lee la preferencia guardada recién en el cliente (evita diferencias de hidratación).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabledState(readEnabled());
  }, []);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    return ctxRef.current;
  }, []);

  // Desbloqueo del audio con la primera interacción.
  useEffect(() => {
    const unlock = () => {
      const ctx = getCtx();
      if (ctx && ctx.state === "suspended") void ctx.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [getCtx]);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const play = useCallback(
    (kind: Kind) => {
      if (!enabledRef.current) return;
      try {
        const ctx = getCtx();
        if (!ctx) return;
        if (ctx.state === "suspended") void ctx.resume();
        let t = ctx.currentTime + 0.02;
        for (const [freq, dur, gap] of PATTERNS[kind]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + dur + 0.02);
          t += dur + gap;
        }
      } catch {
        // Sin audio disponible: la alerta visual sigue funcionando.
      }
    },
    [getCtx],
  );

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    enabledRef.current = v;
    try {
      localStorage.setItem(STORAGE_KEY, v ? "on" : "off");
    } catch {
      // ignorar
    }
  }, []);

  return useMemo(() => ({ enabled, setEnabled, play }), [enabled, setEnabled, play]);
}
