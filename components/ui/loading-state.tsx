"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Waiting indicators describe a pending response, never a saved transaction. */
export function LoadingState({ label, detail, compact = false }: { label: string; detail?: string; compact?: boolean }) {
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const connection = () => setOffline(!navigator.onLine);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    const timer = window.setTimeout(() => setSlow(true), 6000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  const hint = offline ? "You appear to be offline. Waiting for a connection." : slow ? "This is taking longer than usual. Waiting for the server response." : detail;
  return <div className={cn("network-loading", compact && "network-loading-compact")} role="status" aria-live="polite" aria-atomic="true">
    <div className="network-loading-heading">
      <span className="network-loading-mark" aria-hidden="true"><i /><i /><i /></span>
      <div className="network-loading-copy"><strong>{label}</strong>{hint && <p>{hint}</p>}</div>
    </div>
    {!compact && <div className="network-loading-preview" aria-hidden="true">
      <div className="network-loading-toolbar"><span /><span /><span /></div>
      <div className="network-loading-grid">{[0, 1, 2, 3].map(row => <div className="network-loading-row" key={row}><span /><span /><span /><span /></div>)}</div>
    </div>}
  </div>;
}

/** Delay incidental refresh feedback, then retain it briefly for a quiet exit. */
export function RefreshStatus({ active, label = "Refreshing inventory", detail = "Your current view stays available while records update." }: { active: boolean; label?: string; detail?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(active), active ? 220 : 180);
    return () => window.clearTimeout(timer);
  }, [active]);
  if (!visible) return null;
  return <div className="network-refresh" data-leaving={!active} aria-hidden={!active}><LoadingState compact label={label} detail={detail} /></div>;
}
