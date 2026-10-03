"use client";

import { useEffect, useState } from "react";
import { Download, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { InventorySnapshot, AuditEvent } from "@/lib/domain";
import {
  actionNames,
  formatTime,
  durationLabel,
  reloadSessionPage,
} from "@/lib/client-utils";
import { groupActivity, filterActivity } from "@/lib/group-activity";
import { ActivityExportDialog } from "./activity-export-dialog";

type ActivityScope = "all" | "mine";

export function ActivityHistory({
  data,
  onDetail,
  scope = "all",
  revision = 0,
  groupId = null,
  onGroupFilterChange,
  onDialogChange,
}: {
  data: InventorySnapshot;
  onDetail: (id: string) => void;
  scope?: ActivityScope;
  revision?: number;
  groupId?: string | null;
  onGroupFilterChange?: (id: string | null) => void;
  onDialogChange?: (open: boolean) => void;
}) {
  type HistoryResult = {
    context: string;
    sourceEvents: AuditEvent[];
    revision: number;
    retry: number;
    events: AuditEvent[];
    error: string;
  };
  const context = `${data.dataset}-${scope}-${data.user.id}`;
  const [history, setHistory] = useState<HistoryResult | null>(null),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [retry, setRetry] = useState(0);
  const [downloadOpen, setDownloadOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    onDialogChange?.(downloadOpen);
    return () => onDialogChange?.(false);
  }, [downloadOpen, onDialogChange]);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    const result = { context, sourceEvents: data.events, revision, retry };
    fetch(
      `/api/inventory?${new URLSearchParams({ dataset: data.dataset, activity: "all", activityScope: scope })}`,
      { signal: abort.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (response.status === 401) reloadSessionPage("/signin");
        const body = (await response.json()) as {
          error?: string;
          events: AuditEvent[];
        };
        if (!response.ok)
          throw new Error(
            body.error || "The complete activity history could not be loaded.",
          );
        if (!Array.isArray(body.events))
          throw new Error(
            "The activity response was incomplete. Retry the history request.",
          );
        if (active && !abort.signal.aborted)
          setHistory({ ...result, events: body.events, error: "" });
      })
      .catch((error) => {
        if (active && !abort.signal.aborted)
          setHistory({
            ...result,
            events: [],
            error:
              (error as Error).message ||
              "The activity history could not be loaded.",
          });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [context, data.dataset, data.events, revision, retry, scope]);
  const current =
    history?.context === context &&
    history.sourceEvents === data.events &&
    history.revision === revision &&
    history.retry === retry;
  const loading = !current,
    error = current ? history.error : "",
    events = current && !error ? history.events : [];
  const entries = groupActivity(events),
    matching = filterActivity(entries, query, groupId),
    maxPage = Math.max(0, Math.ceil(matching.length / 25) - 1),
    currentPage = Math.min(page, maxPage);
  const visible = matching.slice(currentPage * 25, (currentPage + 1) * 25);
  const groupChoices = [
    ...new Map(
      entries.flatMap((entry) =>
        entry.teachingGroup
          ? [[entry.teachingGroup.id, entry.teachingGroup.name] as const]
          : [],
      ),
    ).entries(),
  ];
  const chosen = selected.filter((id) =>
    entries.some((entry) => entry.id === id),
  );
  const countLabel = `${matching.length} matching ${matching.length === 1 ? "operation" : "operations"}`;
  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      checked
        ? [...new Set([...previous, id])]
        : previous.filter((value) => value !== id),
    );
  }
  return (
    <section
      className="inventory-panel"
      aria-label={
        scope === "mine" ? "My activity records" : "Shared activity records"
      }
      aria-busy={loading}
    >
      <div className="section-heading">
        <div>
          <h2>
            {scope === "mine" ? "My recorded activity" : "Recorded activity"}
          </h2>
          <p className="field-hint">
            {scope === "mine"
              ? "Inventory operations recorded by your signed-in staff account."
              : "Recorded inventory operations across all staff accounts."}
          </p>
        </div>
        <span className="toolbar-meta">
          {loading
            ? "Loading complete history…"
            : error
              ? "History unavailable"
              : `${countLabel} · Sydney time`}
        </span>
      </div>
      <div className="table-toolbar">
        <Input
          aria-label="Search activity"
          placeholder="Search group, battery, operator or action…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
        {onGroupFilterChange && (
          <Select
            value={groupId ?? "__all"}
            onValueChange={(id) => {
              onGroupFilterChange(id === "__all" ? null : id);
              setPage(0);
            }}
          >
            <SelectTrigger aria-label="Activity teaching group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All recorded operations</SelectItem>
              {groupChoices.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
              {groupId && !groupChoices.some(([id]) => id === groupId) && (
                <SelectItem value={groupId} disabled>
                  Group has no recorded activity
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setQuery("");
            onGroupFilterChange?.(null);
            setPage(0);
          }}
          disabled={!query && !groupId}
        >
          Clear filters
        </Button>
        <Button
          variant="outline"
          disabled={loading || !!error || (!matching.length && !chosen.length)}
          onClick={() => setDownloadOpen(true)}
        >
          <Download size={16} />
          Download filtered history
        </Button>
      </div>
      {(query || groupId) && (
        <p className="field-hint">
          Applied filters: {query && `Search: ${query}`}
          {query && groupId && " · "}
          {groupId &&
            `Teaching group: ${groupChoices.find(([id]) => id === groupId)?.[1] ?? "Recorded group"}`}
        </p>
      )}
      {!!chosen.length && (
        <div className="selection-toolbar">
          <strong>{chosen.length} operations selected</strong>
          <Button variant="outline" onClick={() => setDownloadOpen(true)}>
            Download selected activity
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      )}
      {loading ? (
        <div className="loading-panel" role="status">
          <p>
            Loading the complete{" "}
            {scope === "mine"
              ? "history of your inventory operations"
              : "inventory activity history"}
            …
          </p>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <div className="load-error" role="alert">
          <span>{error}</span>
          <Button
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry history
          </Button>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    aria-label="Select activity on this page"
                    checked={
                      visible.length > 0 &&
                      visible.every((event) => chosen.includes(event.id))
                        ? true
                        : visible.some((event) => chosen.includes(event.id))
                          ? "indeterminate"
                          : false
                    }
                    disabled={!visible.length}
                    onCheckedChange={(value) =>
                      setSelected((previous) =>
                        value === true
                          ? [
                              ...new Set([
                                ...previous,
                                ...visible.map((event) => event.id),
                              ]),
                            ]
                          : previous.filter(
                              (id) => !visible.some((event) => event.id === id),
                            ),
                      )
                    }
                  />
                </TableHead>
                <TableHead>ACTION / DETAILS</TableHead>
                <TableHead>BATTERY / TEACHING GROUP</TableHead>
                <TableHead>OPERATOR</TableHead>
                <TableHead>RECORDED AT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select activity ${event.id}`}
                      checked={chosen.includes(event.id)}
                      onCheckedChange={(value) =>
                        toggle(event.id, value === true)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <strong>{actionNames[event.action] ?? event.action}</strong>
                    {event.teachingGroup ? (
                      <details className="group-activity-details">
                        <summary>
                          View {event.members!.length} recorded battery actions
                        </summary>
                        <p className="field-hint">
                          {event.teachingGroup.name} · Group version{" "}
                          {event.teachingGroup.version} at operation time
                        </p>
                        {event.members!.map((member) => (
                          <article className="history-entry" key={member.id}>
                            <button
                              className="record-link"
                              onClick={() => onDetail(member.batteryId!)}
                            >
                              {member.batteryId}
                            </button>
                            <EventDescription event={member} />
                            <p className="field-hint">
                              {member.actorName} · {formatTime(member.at)}
                            </p>
                            <details>
                              <summary>Recorded evidence</summary>
                              <pre className="group-evidence">
                                {JSON.stringify(member.details, null, 2)}
                              </pre>
                            </details>
                          </article>
                        ))}
                      </details>
                    ) : (
                      <EventDescription event={event} />
                    )}
                  </TableCell>
                  <TableCell>
                    {event.teachingGroup ? (
                      <>
                        <strong>{event.teachingGroup.name}</strong>
                        <span className="cell-secondary">
                          {event.members!.length} batteries in this operation
                        </span>
                      </>
                    ) : event.batteryId ? (
                      <button
                        className="record-link"
                        onClick={() => onDetail(event.batteryId!)}
                      >
                        {event.batteryId}
                      </button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{event.actorName}</TableCell>
                  <TableCell>{formatTime(event.at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!matching.length && (
            <div className="empty-state">
              <ClipboardList />
              <h3>
                {events.length
                  ? "No matching activity"
                  : scope === "mine"
                    ? "You have no recorded activity yet"
                    : "No recorded activity"}
              </h3>
              <p>
                {events.length
                  ? "Try another search."
                  : "Confirmed inventory operations will appear here."}
              </p>
            </div>
          )}
          <div className="pagination-bar">
            <span>{countLabel}</span>
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span>
                Page {currentPage + 1} of {maxPage + 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= maxPage}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
      {downloadOpen && (
        <ActivityExportDialog
          dataset={data.dataset}
          scope={scope}
          search={query}
          groupId={groupId}
          selectedIds={chosen}
          count={matching.length}
          onClose={() => setDownloadOpen(false)}
        />
      )}
      <div className="panel-footer">
        Search and download include the complete stored{" "}
        {scope === "mine"
          ? "history of your recorded inventory operations"
          : "inventory activity history"}
        . Corrections retain the original action.
      </div>
    </section>
  );
}

function EventDescription({ event }: { event: AuditEvent }) {
  const d = event.details,
    after = d.after as
      | {
          id?: string;
          name?: string;
        }
      | undefined;
  const text =
    typeof d.reason === "string"
      ? `Reason: ${d.reason}`
      : typeof d.borrower === "string"
        ? `Borrower: ${d.borrower}`
        : event.action === "records_imported"
          ? `${d.count} ${d.kind} imported`
          : typeof d.room === "string"
            ? `${d.room} · ${d.source}`
            : event.action === "charge_recorded"
              ? `Completed ${formatTime(String(d.completedAt))} · ${durationLabel(typeof d.durationMinutes === "number" ? d.durationMinutes : null)}`
              : after?.name
                ? `${after.name} · ${after.id}`
                : typeof d.note === "string"
                  ? d.note
                  : "";
  return text ? <span className="cell-secondary">{text}</span> : null;
}
