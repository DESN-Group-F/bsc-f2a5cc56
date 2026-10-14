"use client";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { inventoryResponse } from "../lib/client/inventory-request.js";
import { advanceArrivalClock } from "../lib/new-arrivals.js";
const elapsedClock = () => Math.floor(performance.now() / 1000) * 1000;
const serverClock = () => 0;
function subscribeClock(listener) {
    const interval = window.setInterval(listener, 1000);
    return () => window.clearInterval(interval);
}
export function useNewArrivals(data, load) {
    const clock = useSyncExternalStore(subscribeClock, elapsedClock, serverClock);
    const projection = data?.newArrivals;
    const [anchor, setAnchor] = useState({ arrivals: projection, receivedAt: clock });
    if (anchor.arrivals !== projection)
        setAnchor({ arrivals: projection, receivedAt: clock });
    const arrivals = advanceArrivalClock(anchor.arrivals, clock - anchor.receivedAt);
    const context = data ? `${data.dataset}:${data.user.id}` : "";
    const currentContext = useRef(context);
    const request = useRef(null);
    const retry = useRef(null);
    const [feedback, setFeedback] = useState({ context: "", pending: false, error: "" });
    useLayoutEffect(() => {
        currentContext.current = context;
        retry.current = null;
        return () => {
            request.current?.abort();
            request.current = null;
        };
    }, [context]);
    async function acknowledge(throughSequence) {
        if (!data || currentContext.current !== context || request.current || !Number.isSafeInteger(throughSequence) || throughSequence < 0)
            return;
        const captured = { context, dataset: data.dataset, actorAccountId: data.user.id, throughSequence: retry.current?.context === context ? retry.current.throughSequence : throughSequence };
        retry.current = { context, throughSequence: captured.throughSequence };
        const abort = new AbortController();
        request.current = abort;
        setFeedback({ context, pending: true, error: "" });
        try {
            const response = await inventoryResponse(await fetch("/api/inventory", {
                method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
                body: JSON.stringify({ dataset: captured.dataset, action: "new_arrivals_ack", payload: { throughSequence: captured.throughSequence } }),
            }));
            if (abort.signal.aborted || currentContext.current !== captured.context)
                return;
            if (response.ok !== true || !response.result || response.result.dataset !== captured.dataset || response.result.actorAccountId !== captured.actorAccountId || !Number.isSafeInteger(response.result.acknowledgedThroughSequence) || response.result.acknowledgedThroughSequence < captured.throughSequence)
                throw new Error("New arrivals acknowledgement could not be verified. Open New arrivals again to retry.");
            await load(captured.dataset, abort.signal);
            if (!abort.signal.aborted && currentContext.current === captured.context) {
                retry.current = null;
                setFeedback({ context, pending: false, error: "" });
            }
        }
        catch (error) {
            if (!abort.signal.aborted && currentContext.current === captured.context)
                setFeedback({ context, pending: false, error: `${error.message} Open New arrivals again to retry.` });
        }
        finally {
            if (request.current === abort)
                request.current = null;
        }
    }
    return { arrivals, acknowledge, pending: feedback.context === context && feedback.pending, error: feedback.context === context ? feedback.error : "" };
}
