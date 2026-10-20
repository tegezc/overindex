import { featuredCacheDir } from "@/features/report/application/cache-dir";
import { listFeatured } from "@/features/report/infrastructure/featured-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const featured = await listFeatured(featuredCacheDir());
  return Response.json(featured);
}
