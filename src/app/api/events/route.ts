import { errorResponse, getAuth, getStore } from "@/server/app";
import { runScheduler } from "@/server/services/scheduler";

export const dynamic = "force-dynamic";

/**
 * Canal de tiempo real (Server-Sent Events, RNF-11). Emite la versión de la base cada vez que cambia;
 * los clientes vuelven a consultar los datos visibles sin recargar la página.
 */
export async function GET(request: Request) {
  try {
    await getAuth();
  } catch (e) {
    return errorResponse(e);
  }
  const store = getStore();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      let last = -1;
      let ticks = 0;
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          if (timer) clearInterval(timer);
        }
      };
      const check = () => {
        ticks++;
        try {
          if (ticks % 10 === 0) runScheduler(store);
          const v = store.version();
          if (v !== last) {
            last = v;
            send(`data: ${JSON.stringify({ version: v })}\n\n`);
          } else if (ticks % 15 === 0) {
            send(`: ping\n\n`);
          }
        } catch (e) {
          console.error("SSE", e);
        }
      };
      send(`retry: 3000\n\n`);
      check();
      timer = setInterval(check, 1000);
      request.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
