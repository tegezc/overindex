import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { DescribeEnvelope } from "@/shared/qloo/domain/envelope";
import { selectBrand, type BrandHit } from "../domain/select-brand";

export async function resolveBrandName(
  name: string,
  describe: (input: { entity: string; type: "brand" }) => Promise<QlooCall<DescribeEnvelope>>,
): Promise<BrandHit | undefined> {
  const described = await describe({ entity: name, type: "brand" });
  if (described.data.status === "error") return undefined;
  return selectBrand(described.data, name);
}
