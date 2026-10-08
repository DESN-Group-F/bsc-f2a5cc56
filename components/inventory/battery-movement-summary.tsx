"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Archive, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isActiveBattery } from "@/lib/battery-lifecycle";
import { buildBatteryMovementSummary } from "@/lib/battery-movement-summary";
import { formatTime } from "@/lib/client-utils";
import type { BatteryDetail } from "@/lib/domain";

export function BatteryMovementSummary({ detail, error, onRetry }: {
    detail: BatteryDetail | null;
    error: string;
    onRetry: () => void;
}) {
    if (error) return <section className="battery-movement-summary movement-unavailable" aria-label="Check-in and check-out">
        <h3>Check-in / check-out</h3>
        <div role="alert"><p>Movement details could not be loaded.</p><p>{error}</p></div>
        <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw size={16} />Retry details</Button>
    </section>;

    if (!detail) return <section className="battery-movement-summary movement-loading" aria-label="Loading check-in and check-out details" aria-busy="true">
        <h3>Check-in / check-out</h3>
        <div className="movement-current"><Skeleton className="h-5 w-28" /><Skeleton className="h-10 w-48 max-w-full" /><Skeleton className="h-5 w-40 max-w-full" /></div>
        <span className="sr-only">Loading movement details.</span>
    </section>;

    return <LoadedMovementSummary detail={detail} />;
}

function LoadedMovementSummary({ detail }: { detail: BatteryDetail }) {
    const [now, setNow] = useState(() => new Date());
    const terminal = !isActiveBattery(detail.battery);
    useEffect(() => {
        if (terminal) return;
        const timer = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(timer);
    }, [terminal]);

    const summary = buildBatteryMovementSummary(detail, now);
    const durationIsMessage = ["No return recorded", "Tracking ended", "Not available"].includes(summary.duration);
    const StatusIcon = terminal ? Archive : summary.status === "in_use" ? ArrowUpRight : ArrowDownLeft;

    return <section className={`battery-movement-summary${terminal ? " movement-terminal" : ""}`} aria-label="Check-in and check-out">
        <h3>Check-in / check-out</h3>
        <div className="movement-layout">
        <div className="movement-current">
            <div className="movement-status"><StatusIcon size={19} aria-hidden="true" /><strong>{summary.statusLabel}</strong></div>
            <p className="movement-label">{summary.durationLabel}</p>
            <p className={`movement-duration${durationIsMessage ? " movement-duration-message" : ""}`}>{summary.duration}</p>
            <dl className="movement-person"><dt>{summary.personLabel}</dt><dd>{summary.personName}</dd></dl>
            <p className="movement-when">{summary.timestampLabel}{summary.startedAt ? <> <time dateTime={summary.startedAt}>{formatTime(summary.startedAt)}</time></> : " · Time unavailable"}</p>
        </div>
        <div className="movement-records">
        <h4 className="movement-timeline-title">Recent movements</h4>
        {summary.timeline.length ? <ol className="movement-timeline" aria-label="Recent recorded movements">
            {summary.timeline.map(event => <li key={event.id} className={`movement-event movement-event-${event.kind}`}>
                <div className="movement-event-heading">
                    <strong>{event.kind === "return" ? "Check-in · Returned" : event.kind === "checkout" ? "Check-out · Borrowed" : "Battery registered"}</strong>
                    {event.at ? <time dateTime={event.at}>{formatTime(event.at)}</time> : <span>Time unavailable</span>}
                </div>
                {event.kind === "checkout" && <p>Borrowed by <strong>{event.borrowerName || "Not recorded"}</strong></p>}
                <p>{event.kind === "return" ? "Return recorded by" : event.kind === "checkout" ? "Checkout recorded by" : "Registered by"} <strong>{event.actorName || "Not recorded"}</strong></p>
                {event.currentLoan ? <p className="movement-loan-duration"><Clock3 size={13} aria-hidden="true" />Current loan</p> : event.loanDuration && <p className="movement-loan-duration"><Clock3 size={13} aria-hidden="true" />Loan duration: {event.loanDuration}</p>}
            </li>)}
        </ol> : <p className="movement-empty">No movement records are available.</p>}
        </div>
        </div>
        <p className="movement-evidence-note">Recorded check-ins and check-outs, not live location. Times use Australia/Sydney. Corrections remain in Loans and Audit history.</p>
    </section>;
}
