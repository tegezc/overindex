import { HomeForm } from "@/features/show/presentation/home-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">overindex</h1>
        <p className="text-base opacity-80">Name a podcast. Get the brands its audience over-indexes on.</p>
      </div>
      <HomeForm />
    </main>
  );
}
