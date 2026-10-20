"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HomeForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        router.push(`/confirm?q=${encodeURIComponent(trimmed)}`);
      }}
    >
      <label className="flex flex-col gap-2 text-sm" htmlFor="show-query">
        Podcast name
        <input
          id="show-query"
          name="query"
          data-testid="home-query"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          className="rounded-md border border-current/20 bg-transparent px-3 py-2 text-base"
          autoComplete="off"
        />
      </label>
      <button
        type="submit"
        data-testid="home-submit"
        disabled={!trimmed}
        className="w-fit rounded-md border border-current px-4 py-2 text-sm disabled:opacity-40"
      >
        Find show
      </button>
    </form>
  );
}
