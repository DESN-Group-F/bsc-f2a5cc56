"use client";

import type { ComponentProps } from "react";
import type { DownloadCompletion } from "@/hooks/use-download-feedback";
import { ReceiptAction } from "./receipt-action";

type DownloadActionProps = Omit<ComponentProps<typeof ReceiptAction>, "confirmation" | "pendingAnnouncement" | "confirmationAnnouncement"> & {
  completion: DownloadCompletion | null;
};

/** Use the shared spring acknowledgement after the actual attachment handoff. */
export function DownloadAction({ completion, pending, ...props }: DownloadActionProps) {
  return <ReceiptAction {...props} pending={pending} aria-busy={pending}
    confirmation={completion ? { identity: completion.identity, count: 1, text: "Download ready" } : null}
    pendingAnnouncement="Preparing your download."
    confirmationAnnouncement="The file is ready. Your browser was asked to save it." />;
}
