"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DownloadAction } from "@/components/ui/download-action";
import { MotionPresence } from "@/components/ui/workspace-motion";
import { useDownloadFeedback } from "@/hooks/use-download-feedback";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadTaskReport } from "@/lib/client-utils";

export type TaskDownloadRequest = { url: string; filename: string; title: string; scope: string };
export function TaskDownloadDialog({ request, onClose, onBusyChange }: { request: TaskDownloadRequest; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const [format, setFormat] = useState<"xlsx" | "json">("xlsx");
  const reviewKey = JSON.stringify({ request, format });
  const { busy, error, completion, running, run } = useDownloadFeedback(reviewKey);
  async function download() {
    await run(() => downloadTaskReport(`${request.url}&download=${format}`, format, `${request.filename}.${format}`), onBusyChange);
  }
  return <Dialog open onOpenChange={open => { if (!open && !running.current) onClose(); }}>
    <DialogContent showCloseButton={!busy} onEscapeKeyDown={event => { if (running.current) event.preventDefault(); }} onInteractOutside={event => { if (running.current) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        <DialogDescription>{request.scope} The current filters are captured for this download.</DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-3" disabled={busy}>
        <legend className="mb-2 text-sm font-semibold">File format</legend>
        <label className="export-option">
          <input type="radio" name="task-download-format" value="xlsx" checked={format === "xlsx"} onChange={() => !running.current && setFormat("xlsx")} />
          <span><strong>Excel report · Recommended</strong><small>A reading guide, clearly named columns, staff names and local dates. Technical evidence is kept in separate labelled worksheets.</small></span>
        </label>
        <label className="export-option">
          <input type="radio" name="task-download-format" value="json" checked={format === "json"} onChange={() => !running.current && setFormat("json")} />
          <span><strong>JSON · Technical data</strong><small>Original structured fields and internal identifiers for analysis, reconciliation or system integration.</small></span>
        </label>
      </fieldset>
      <MotionPresence>{error && <p className="form-error" role="alert">{error}</p>}</MotionPresence>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}><span key={completion ? "done" : "cancel"} className="download-close-label">{completion ? "Done" : "Cancel"}</span></Button>
        <DownloadAction onClick={() => void download()} disabled={busy} pending={busy} completion={completion} reviewKey={reviewKey} actionLabel={format === "xlsx" ? "Download Excel report" : "Download JSON data"}>{format === "xlsx" ? "Download Excel report" : "Download JSON data"}</DownloadAction>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
