import type { BrandCandidate, Quadrant } from "@/features/sponsor-discovery/domain/types";
import type { SectionStatus } from "../domain/report";

const PLOTTED = ["proven", "hidden", "category_only"] as const;

const COPY: Record<Exclude<Quadrant, "none">, { title: string; detail: string }> = {
  proven: {
    title: "Proven",
    detail: "On the without-Qloo list and high fit. Usually easier to explain, and more contested.",
  },
  hidden: {
    title: "Hidden",
    detail: "High fit in the taste graph, and absent from the without-Qloo list.",
  },
  category_only: {
    title: "Category-only",
    detail: "On the without-Qloo list, with a weak taste signal. That is not a claim the brand would refuse.",
  },
};

export function QuadrantChart({
  status,
  note,
  candidates,
}: {
  status: SectionStatus;
  note?: string;
  candidates: readonly BrandCandidate[];
}) {
  const plotted = candidates.filter((candidate) => candidate.quadrant !== "none");
  return (
    <section className="flex flex-col gap-3" data-testid="section-quadrant" data-status={status}>
      <h2 className="flex items-baseline justify-between gap-3 text-lg font-semibold">
        <span>Fit quadrant</span>
        <span className="text-sm font-medium" data-testid="section-quadrant-status">
          {status}
        </span>
      </h2>
      <p className="text-sm opacity-80">
        Horizontal: whether the brand is on the without-Qloo list. Vertical: fit from Qloo affinity. Brands low on both axes are
        left off this chart.
      </p>
      {note ? <p className="text-sm">{note}</p> : null}
      {status === "pending" ? <p className="text-sm">Waiting for this section.</p> : null}
      {status === "error" || status === "empty" || status === "needs_input" ? null : (
        <div className="flex flex-col gap-4">
          <svg viewBox="0 0 320 240" role="img" className="h-60 w-full max-w-md" aria-label="Fit quadrant">
            <rect x="40" y="16" width="120" height="90" fill="currentColor" opacity="0.06" />
            <rect x="160" y="16" width="120" height="90" fill="currentColor" opacity="0.03" />
            <rect x="40" y="106" width="120" height="90" fill="currentColor" opacity="0.03" />
            <line x1="40" y1="196" x2="280" y2="196" stroke="currentColor" strokeWidth="1" />
            <line x1="40" y1="16" x2="40" y2="196" stroke="currentColor" strokeWidth="1" />
            <text x="100" y="32" textAnchor="middle" fontSize="11" fill="currentColor">
              Proven
            </text>
            <text x="220" y="32" textAnchor="middle" fontSize="11" fill="currentColor">
              Hidden
            </text>
            <text x="100" y="122" textAnchor="middle" fontSize="11" fill="currentColor">
              Category-only
            </text>
            {plotted.map((candidate, index) => {
              const point = position(candidate.quadrant, index);
              return <circle key={candidate.brand.id} cx={point.x} cy={point.y} r="4" fill="currentColor" />;
            })}
          </svg>
          <div className="grid gap-3 sm:grid-cols-3">
            {PLOTTED.map((quadrant) => {
              const rows = plotted.filter((candidate) => candidate.quadrant === quadrant);
              const copy = COPY[quadrant];
              return (
                <div key={quadrant} className="flex flex-col gap-1 text-sm">
                  <h3 className="font-medium">{copy.title}</h3>
                  <p className="opacity-75">{copy.detail}</p>
                  {rows.length === 0 ? <p className="opacity-70">None in this run.</p> : null}
                  <ul>
                    {rows.map((candidate) => (
                      <li key={candidate.brand.id}>{candidate.brand.name}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function position(quadrant: Quadrant, index: number): { x: number; y: number } {
  const column = quadrant === "hidden" ? 1 : 0;
  const row = quadrant === "category_only" ? 1 : 0;
  return {
    x: 70 + column * 120 + (index % 4) * 14,
    y: 48 + row * 90 + (index % 3) * 12,
  };
}
