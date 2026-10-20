import { Suspense } from "react";
import { ConfirmScreen } from "@/features/show/presentation/confirm-screen";

export default function ConfirmPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <Suspense fallback={<p>Loading confirm.</p>}>
        <ConfirmScreen />
      </Suspense>
    </main>
  );
}
