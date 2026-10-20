import type { ReactNode } from "react";
import type { TasteCard, TasteDomain, TasteSection } from "../domain/taste-card";

const DOMAIN_LABELS: Record<TasteDomain, string> = {
  artist: "Artists",
  tv_show: "TV shows",
  movie: "Movies",
  book: "Books",
};

export function TasteCardView({ card }: { card: TasteCard }) {
  const domains = Object.keys(DOMAIN_LABELS) as TasteDomain[];
  return (
    <section className="flex flex-col gap-4" data-testid="taste-card" data-domain-count={domains.length}>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{card.show.name}</h2>
        <p className="text-sm opacity-80">
          Audience taste card for the confirmed show. Source: Qloo. Each section has its own status.
        </p>
      </div>
      <Section title="Tags" testId="section-tags" section={card.tags} empty="No tags.">
        <ul className="flex flex-wrap gap-2">
          {card.tags.data?.map((tag) => (
            <li key={tag.id} className="rounded-full border border-current/20 px-2 py-1 text-sm">
              {tag.name}
            </li>
          ))}
        </ul>
      </Section>
      {domains.map((domain) => {
        const section = card.domains[domain];
        return (
          <Section key={domain} title={DOMAIN_LABELS[domain]} testId={`domain-${domain}`} section={section} empty="No entities.">
            <ul className="flex flex-col gap-1 text-sm">
              {section.data?.map((entity) => (
                <li key={entity.id}>{entity.name}</li>
              ))}
            </ul>
          </Section>
        );
      })}
      {card.demographics ? (
        <Section title="Demographics" testId="section-demographics" section={card.demographics} empty="">
          <ul className="flex flex-col gap-1 text-sm">
            {card.demographics.data?.map((row) => (
              <li key={row.label}>
                {row.label}
                {row.value === undefined ? null : <span className="opacity-70"> · Qloo value {formatValue(row.value)}</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-70">Aggregate figures from Qloo. Not a claim about individual listeners.</p>
        </Section>
      ) : null}
    </section>
  );
}

function Section<T>({
  title,
  testId,
  section,
  empty,
  children,
}: {
  title: string;
  testId: string;
  section: TasteSection<T>;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-current/15 p-3" data-testid={testId} data-status={section.status}>
      <h3 className="flex items-baseline justify-between gap-3 text-sm font-medium">
        <span>{title}</span>
        <span data-testid={`${testId}-status`}>{section.status}</span>
      </h3>
      {section.data ? children : <p className="text-sm opacity-70">{section.note ?? empty}</p>}
    </section>
  );
}

function formatValue(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
