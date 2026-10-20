import Link from "next/link";
import { featuredCacheDir } from "@/features/report/application/cache-dir";
import { listFeatured } from "@/features/report/infrastructure/featured-store";
import { HomeForm } from "@/features/show/presentation/home-form";

export const dynamic = "force-dynamic";

export default async function Home() {
  const featured = await listFeatured(featuredCacheDir()).catch(() => []);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">overindex</h1>
          <p className="text-base opacity-80">Name a podcast. Get the brands its audience over-indexes on.</p>
        </div>
        <HomeForm />
      </div>
      <section id="featured" className="flex flex-col gap-3" data-testid="featured-list">
        <h2 className="text-xl font-semibold">Featured reports</h2>
        <p className="text-sm opacity-80">
          Cached reports. Each date is the day that report was saved. Opening one does not start a live report.
        </p>
        {featured.length === 0 ? (
          <p data-testid="featured-empty">No featured reports are cached on this server yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {featured.map((item) => (
              <li key={item.id} className="rounded-md border border-current/15 p-3" data-testid="featured-item">
                <Link className="font-medium underline" href={`/r/${item.id}`}>
                  {item.title}
                </Link>
                <p className="text-sm opacity-80">
                  <time dateTime={item.dataDate} data-testid="featured-date">
                    {item.dataDate}
                  </time>
                  {" · "}
                  <span data-testid="featured-mode">{item.mode}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
