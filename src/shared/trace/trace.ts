import { z } from "zod";
import { envelopeStatusSchema } from "@/shared/qloo/domain/envelope";

export const traceEventSchema = z.object({
  seq: z.number().int().positive(),
  at: z.string().min(1),
  kind: z.enum(["tool_call", "tool_result", "decision", "section", "budget", "error"]),
  tool: z.string().optional(),
  status: envelopeStatusSchema.optional(),
  summary: z.string(),
  durationMs: z.number().nonnegative().optional(),
});

export type TraceEvent = z.infer<typeof traceEventSchema>;

export type TraceDraft = Omit<TraceEvent, "seq" | "at">;

export class MemoryTraceSink {
  private seq = 0;
  private readonly items: TraceEvent[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  emit(event: TraceDraft): TraceEvent {
    const parsed = traceEventSchema.parse({
      ...event,
      seq: ++this.seq,
      at: this.now().toISOString(),
    });
    this.items.push(parsed);
    return parsed;
  }

  events(): readonly TraceEvent[] {
    return this.items;
  }
}
