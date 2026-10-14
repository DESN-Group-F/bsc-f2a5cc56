"use client";
import { useEffect, useRef, useState } from "react";
/** Completion means the validated attachment was handed to the browser, not saved to disk. */
export function useDownloadFeedback(reviewKey) {
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState(null);
    const [completion, setCompletion] = useState(null);
    const running = useRef(false), mounted = useRef(true), attempt = useRef(0);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    async function run(download, onBusyChange) {
        if (running.current)
            return;
        running.current = true;
        const identity = `${reviewKey}:${++attempt.current}`;
        setBusy(true);
        setFailure(null);
        setCompletion(null);
        onBusyChange?.(true);
        try {
            await download();
            if (mounted.current)
                setCompletion({ identity, reviewKey });
        }
        catch (failure) {
            if (mounted.current)
                setFailure({ reviewKey, message: failure instanceof Error && failure.message ? failure.message : "The download could not be prepared. Try again." });
        }
        finally {
            running.current = false;
            if (mounted.current)
                setBusy(false);
            onBusyChange?.(false);
        }
    }
    return { busy, error: failure?.reviewKey === reviewKey ? failure.message : "", completion: completion?.reviewKey === reviewKey ? completion : null, running, run };
}
