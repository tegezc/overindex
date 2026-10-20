import { featuredCacheDir } from "@/features/report/application/cache-dir";
import { encodeSse, getReportBoard, type ReportRun } from "@/features/report/application/execute-report";
import { readFeaturedReport } from "@/features/report/infrastructure/featured-store";
import type { ReportStreamEvent } from "@/features/report/domain/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getReportBoard().get(id);
  if (run) return sse(liveStream(run, request));
  const stored = await readFeaturedReport(featuredCacheDir(), id);
  if (!stored) {
    return Response.json({ error: { code: "NOT_FOUND", message: "No report with that id is on this server." } }, { status: 404 });
  }
  return sse(doneStream(stored.id, request));
}

function liveStream(run: ReportRun, request: Request): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let closed = false;
  return new ReadableStream<Uint8Array>({
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
}

function doneStream(reportId: string, request: Request): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may already have gone away.
        }
      };
      controller.enqueue(encoder.encode(encodeSse({ event: "done", data: { reportId } })));
      const timer = setTimeout(close, 200);
      request.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        close();
      });
    },
    cancel() {
      closed = true;
    },
  });
}

function sse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
