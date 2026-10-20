import { BASELINE_BASKET } from "@/features/sponsor-discovery/domain/basket";
import {
  METHOD_LIMITATIONS,
  METHOD_PROTOCOL,
  METHOD_READING,
  METHOD_RESULTS,
  METHOD_RESULTS_NOTE,
} from "@/features/report/presentation/method-copy";
import { QUADRANT_FIT_THRESHOLD, SCORING_VERSION } from "@/shared/config/scoring";

export default function MethodPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Method and limitations</h1>
        <p className="text-sm opacity-80">How a sponsor report is built, how to read a score, and what this page will not claim yet.</p>
      </div>
      <section className="flex flex-col gap-2" data-testid="method-results">
        <h2 className="text-xl font-semibold">Results</h2>
        <p className="text-lg font-medium">{METHOD_RESULTS}</p>
        <p className="text-sm">{METHOD_RESULTS_NOTE}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Protocol</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {METHOD_PROTOCOL.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">How to read a score</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {METHOD_READING.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-sm">
          Under the current pre-lock rule, high fit means fit is at least {QUADRANT_FIT_THRESHOLD}. Scoring version {SCORING_VERSION}. That
          cutoff is not an evaluation result.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Baseline basket</h2>
        <p className="text-sm">
          Lift compares a show with this fixed basket. The basket leans sports and lifestyle. That composition is part of the method.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {BASELINE_BASKET.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Limitations</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {METHOD_LIMITATIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}