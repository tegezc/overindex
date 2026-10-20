import { ReportScreen } from "@/features/report/presentation/report-screen";

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
      <ReportScreen reportId={reportId} />
    </main>
  );
}
