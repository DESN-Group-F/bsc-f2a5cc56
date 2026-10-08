import type { Dataset } from "../domain";
import { readDownloadAttachment, saveDownloadAttachment } from "../client-utils";
import { teachingCheckoutListedRunSchema } from "../teaching-checkouts";

export async function downloadTeachingCheckoutReport(dataset: Dataset, runId: string, format: "json" | "xlsx") {
  const response = await fetch(`/api/teaching-checkouts?${new URLSearchParams({ dataset, runId, format })}`, { cache: "no-store" });
  const attachment = await readDownloadAttachment(response, format, `teaching-checkout-${dataset}.${format}`, value => {
    const document = value as { metadata?: { dataset?: unknown; runId?: unknown }; tables?: { teaching_evidence?: { snapshot?: unknown }[] } } | null;
    if (document?.metadata?.dataset !== dataset || document.metadata.runId !== runId) return false;
    const run = teachingCheckoutListedRunSchema.safeParse(document.tables?.teaching_evidence?.[0]?.snapshot);
    return run.success && run.data.id === runId && run.data.dataset === dataset;
  });
  saveDownloadAttachment(attachment);
}
