"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dataset } from "@/lib/domain";
import type { OperatorEditPayload } from "@/lib/operator-edit";
import { reloadSessionPage } from "@/lib/client-utils";
import {
  readJournal, removeEntry, settleOutcome, upsertEntries, writeJournal,
  type JournalEntry, type SettledOutcome,
} from "@/lib/console/edit-journal";

export type EditResult =
  | { state: "waiting" }
  | { state: "saving" }
  | { state: "checking" }
  | { state: "saved"; at: string }
  | { state: "not-saved"; message: string }
  | { state: "removed"; message: string }
  | { state: "not-received" }
  | { state: "unknown"; message: string };

const definitiveRefusals = new Set([400, 403, 404, 409, 413, 415, 422]);

/**
 * Sends reviewed metadata edits one battery at a time. Every request is written to this browser's
 * storage before it is sent and leaves storage only when its outcome is verified against the
 * exact original payload. An interrupted request is never replaced by a new one.
 */
export function useMetadataEdits(accountId: string, dataset: Dataset, onChanged: () => void) {
  const context = `${accountId}:${dataset}`;
  const [storage] = useState<Storage | null>(() => {
    try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
  });
  const readFor = useCallback(() => storage
    ? { context, ...readJournal(storage, accountId, dataset) }
    : { context, entries: [] as JournalEntry[], error: "This browser does not allow site storage, so edits cannot be saved safely here." }, [storage, context, accountId, dataset]);
  const [journal, setJournal] = useState<{ context: string; entries: JournalEntry[]; error: string }>(readFor);
  const [results, setResults] = useState<{ context: string; values: Record<string, EditResult> }>({ context, values: {} });
  const [running, setRunning] = useState(false);
  // A different account or inventory has its own saved requests; switch to them during render.
  if (journal.context !== context) setJournal(readFor());
  if (results.context !== context) setResults({ context, values: {} });
  const live = useRef<JournalEntry[]>([]);
  const contextRef = useRef(context);
  useEffect(() => { live.current = journal.entries; contextRef.current = journal.context; }, [journal]);

  useEffect(() => {
    if (!storage) return;
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== storage) return;
      const read = readFor();
      live.current = read.entries;
      setJournal(read);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage, readFor]);

  const persist = useCallback((entries: JournalEntry[]) => {
    if (!storage) throw new Error("Browser storage is unavailable.");
    writeJournal(storage, accountId, dataset, entries);
    live.current = entries;
    setJournal({ context, entries, error: "" });
  }, [accountId, dataset, context, storage]);

  const setResult = useCallback((requestId: string, result: EditResult) => setResults((previous) => ({ context: previous.context, values: { ...previous.values, [requestId]: result } })), []);

  const send = useCallback(async (entry: JournalEntry, mode: "edit" | "lookup"): Promise<EditResult> => {
    if (mode === "edit") {
      try { persist(upsertEntries(live.current, [{ ...entry, state: "sent" }])); }
      catch { const result: EditResult = { state: "unknown", message: "This browser could not update the saved request, so it was not sent. Free browser storage and try again." }; setResult(entry.requestId, result); return result; }
    }
    setResult(entry.requestId, { state: mode === "edit" ? "saving" : "checking" });
    let result: EditResult;
    try {
      const response = await fetch("/api/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ dataset, action: mode === "edit" ? "operator_edit" : "operator_edit_outcome", payload: entry.payload }),
      });
      if (response.status === 401) { reloadSessionPage("/signin"); throw new Error("Your session ended. Sign in again; the request stays saved."); }
      let body: { result?: unknown; error?: string; code?: string };
      try { body = await response.json(); } catch { throw new Error("The server response was interrupted."); }
      if (!response.ok) {
        if (mode === "edit" && definitiveRefusals.has(response.status) && body.code !== "idempotency_conflict") {
          result = { state: "not-saved", message: body.error || "The server refused this edit." };
          persist(removeEntry(live.current, entry.requestId));
        } else result = { state: "unknown", message: body.error || `The server answered ${response.status}. The outcome is not known yet.` };
      } else {
        const settled: SettledOutcome = await settleOutcome(body.result, entry.payload, accountId, dataset);
        if (settled.kind === "not-received") {
          result = { state: "not-received" };
          persist(upsertEntries(live.current, [{ ...entry, state: "prepared", lastError: null }]));
        } else {
          result = settled.kind === "saved" ? { state: "saved", at: settled.at } : settled.kind === "not-saved" ? { state: "not-saved", message: settled.message } : { state: "removed", message: settled.message };
          persist(removeEntry(live.current, entry.requestId));
        }
      }
    } catch (error) {
      result = { state: "unknown", message: (error as Error).message || "The connection was interrupted." };
      try { persist(upsertEntries(live.current, [{ ...live.current.find((item) => item.requestId === entry.requestId) ?? entry, lastError: (result as { message: string }).message }])); } catch { /* the saved request stays as it was */ }
    }
    if (contextRef.current === context) setResult(entry.requestId, result);
    return result;
  }, [accountId, dataset, context, persist, setResult]);

  /** Saves all requests first, then sends them one at a time. */
  const submit = useCallback(async (payloads: OperatorEditPayload[]) => {
    if (running) return { error: "Saving is already in progress." };
    const at = new Date().toISOString();
    const entries: JournalEntry[] = payloads.map((payload) => ({ requestId: payload.requestId, batteryId: payload.batteryId, payload, preparedAt: at, state: "prepared", lastError: null }));
    try { persist(upsertEntries(live.current, entries)); }
    catch { return { error: "This browser could not save the reviewed requests before sending, so nothing was sent. Check that site storage is allowed, then try again." }; }
    setResults((previous) => ({ context: previous.context, values: { ...previous.values, ...Object.fromEntries(entries.map((entry) => [entry.requestId, { state: "waiting" } as EditResult])) } }));
    setRunning(true);
    try {
      for (const entry of entries) {
        if (contextRef.current !== context) break;
        await send(entry, "edit");
      }
    } finally {
      setRunning(false);
      onChanged();
    }
    return { error: "" };
  }, [running, persist, send, context, onChanged]);

  const retry = useCallback(async (requestId: string) => {
    const entry = live.current.find((item) => item.requestId === requestId);
    if (!entry || running) return;
    setRunning(true);
    try { await send(entry, "edit"); } finally { setRunning(false); onChanged(); }
  }, [running, send, onChanged]);

  const check = useCallback(async (requestId: string) => {
    const entry = live.current.find((item) => item.requestId === requestId);
    if (!entry || running) return;
    setRunning(true);
    try { await send(entry, "lookup"); } finally { setRunning(false); onChanged(); }
  }, [running, send, onChanged]);

  /** Only a request known never to have reached the server can be discarded. */
  const discard = useCallback((requestId: string) => {
    const entry = live.current.find((item) => item.requestId === requestId);
    if (!entry || entry.state !== "prepared") return;
    persist(removeEntry(live.current, requestId));
    setResults((previous) => { const values = { ...previous.values }; delete values[requestId]; return { context: previous.context, values }; });
  }, [persist]);

  const clearResults = useCallback((requestIds?: string[]) => {
    setResults((previous) => {
      if (!requestIds) return { context: previous.context, values: Object.fromEntries(Object.entries(previous.values).filter(([id]) => live.current.some((entry) => entry.requestId === id))) };
      const values = { ...previous.values };
      for (const id of requestIds) delete values[id];
      return { context: previous.context, values };
    });
  }, []);

  const current = journal.context === context;
  return { entries: current ? journal.entries : [], storageError: current ? journal.error : "", results: results.context === context ? results.values : {}, running, submit, retry, check, discard, clearResults };
}
