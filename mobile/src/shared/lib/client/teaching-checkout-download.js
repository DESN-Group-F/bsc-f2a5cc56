import { readDownloadAttachment, saveDownloadAttachment } from "../client-utils.js";
import { teachingCheckoutListedRunSchema } from "../teaching-checkouts.js";
export async function downloadTeachingCheckoutReport(dataset, runId, format) {
    const response = await fetch(`/api/teaching-checkouts?${new URLSearchParams({ dataset, runId, format })}`, { cache: "no-store" });
    const attachment = await readDownloadAttachment(response, format, `teaching-checkout-${dataset}.${format}`, value => {
        const document = value;
        if (document?.metadata?.dataset !== dataset || document.metadata.runId !== runId)
            return false;
        const run = teachingCheckoutListedRunSchema.safeParse(document.tables?.teaching_evidence?.[0]?.snapshot);
        return run.success && run.data.id === runId && run.data.dataset === dataset;
    });
    await saveDownloadAttachment(attachment);
}
