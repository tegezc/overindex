import type { QlooCall } from "@/shared/qloo/domain/provenance";
import type { DemographicsEnvelope, EntityTagsEnvelope, RecommendEnvelope } from "@/shared/qloo/domain/envelope";
import type { DemographicsInput, EntityTagsInput, RecommendInput } from "@/shared/qloo/domain/inputs";
import { tasteCardSchema, type TasteCard } from "../domain/taste-card";
import { TASTE_DOMAINS, readTasteEntities, readTasteTags, toDemographicsSection, toTasteSection } from "../domain/taste-card";

const ENTITY_LIMIT = 8;

export type ShowProfileDeps = {
  entityTags(input: EntityTagsInput): Promise<QlooCall<EntityTagsEnvelope>>;
  recommend(input: RecommendInput): Promise<QlooCall<RecommendEnvelope>>;
  audienceDemographics(input: DemographicsInput): Promise<QlooCall<DemographicsEnvelope>>;
};

export async function showProfile(
  show: { id: string; name: string },
  deps: ShowProfileDeps,
): Promise<TasteCard> {
  const tagsCall = deps.entityTags({ entities: [show.id], entity_type: "podcast", limit: 12 });
  const demographicsCall = deps.audienceDemographics({ entity: show.id, entity_type: "podcast", limit: 12 });
  const domainCalls = TASTE_DOMAINS.map((domain) =>
    deps.recommend({
      target_type: domain,
      signals: [show.id],
      limit: ENTITY_LIMIT,
      explain: false,
    }),
  );
  const [tags, demographics, artist, tvShow, movie, book] = await Promise.all([
    tagsCall,
    demographicsCall,
    ...domainCalls,
  ]);
  if (!artist || !tvShow || !movie || !book) {
    throw new Error("taste card domain call is missing");
  }

  const card: TasteCard = {
    show: { id: show.id, name: show.name, type: "podcast" },
    tags: toTasteSection({
      status: tags.data.status,
      items: readTasteTags(tags.data.results),
      errorCode: tags.data.error?.code,
      provenance: tags.provenance,
      emptyNote: "No tags.",
    }),
    domains: {
      artist: domainSection(artist),
      tv_show: domainSection(tvShow),
      movie: domainSection(movie),
      book: domainSection(book),
    },
  };
  const demographicSection = toDemographicsSection({
    status: demographics.data.status,
    results: demographics.data.results,
    errorCode: demographics.data.error?.code,
    provenance: demographics.provenance,
  });
  return tasteCardSchema.parse(demographicSection ? { ...card, demographics: demographicSection } : card);
}

function domainSection(call: QlooCall<RecommendEnvelope>) {
  return toTasteSection({
    status: call.data.status,
    items: readTasteEntities(call.data.results, ENTITY_LIMIT),
    errorCode: call.data.error?.code,
    provenance: call.provenance,
    emptyNote: "No entities.",
  });
}
