import { encodeSse, getReportBoard } from "@/features/report/application/execute-report";
import type { ReportStreamEvent } from "@/features/report/domain/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getReportBoard().get(id);
  if (!run) return Response.json({ error: { code: "NOT_FOUND", message: "No report with that id is on this server." } }, { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The client may already have gone away.
        }
      };
      const send = (event: ReportStreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSse(event)));
        // Close on a later turn so the browser can dispatch the done event before the socket ends.
        if (event.event === "done") setTimeout(close, 200);
      };
      for (const event of run.events) send(event);
      if (closed || run.finished) {
        close();
        return;
      }
      unsubscribe = run.subscribe(send);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
