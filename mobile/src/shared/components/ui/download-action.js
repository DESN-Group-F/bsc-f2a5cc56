"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { ReceiptAction } from "./receipt-action.js";
/** Use the shared spring acknowledgement after the actual attachment handoff. */
export function DownloadAction({ completion, pending, ...props }) {
    return _jsx(ReceiptAction, { ...props, pending: pending, "aria-busy": pending, confirmation: completion ? { identity: completion.identity, count: 1, text: "Download ready" } : null, pendingAnnouncement: "Preparing your download.", confirmationAnnouncement: "The file is ready. Your browser was asked to save it." });
}
