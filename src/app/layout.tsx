import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "overindex",
  description: "Sponsor reports for podcasts, grounded in audience taste affinity.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .media-kit-sheet, .media-kit-sheet * { visibility: visible; }
            .media-kit-sheet { position: absolute; left: 0; top: 0; width: 100%; border: none; }
            .no-print { display: none !important; }
          }
        `}</style>
        <header className="no-print mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4 text-sm">
          <Link href="/" className="font-medium">
            overindex
          </Link>
          <Link href="/method">Method</Link>
        </header>
        {children}
      </body>
    </html>
  );
}
