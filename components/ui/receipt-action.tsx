"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reducedMotion, spring } from "@/lib/client/workspace-motion";
import styles from "./receipt-action.module.css";

export type ReceiptConfirmation = { identity: string; count: number; text: string };
type ReceiptActionProps = ComponentProps<typeof Button> & {
  pending: boolean;
  confirmation?: ReceiptConfirmation | null;
  reviewKey: string;
  actionLabel: string;
  pendingAnnouncement?: string;
  confirmationAnnouncement?: string;
};

/** A visual receipt acknowledgement never submits, retries or settles a request. */
export function ReceiptAction({ pending, confirmation, reviewKey, actionLabel, pendingAnnouncement, confirmationAnnouncement, children, onClick, className, ...props }: ReceiptActionProps) {
  const [phase, setPhase] = useState<"idle" | "pending" | "check" | "confirmed">("idle");
  const [acknowledgement, setAcknowledgement] = useState<ReceiptConfirmation | null>(null);
  const armed = useRef(false), seen = useRef(confirmation?.identity), previousReview = useRef(reviewKey), wasPending = useRef(false);
  const element = useRef<HTMLButtonElement>(null), footprint = useRef<HTMLSpanElement>(null);
  const idleMeasure = useRef<HTMLSpanElement>(null), resultMeasure = useRef<HTMLSpanElement>(null);
  const cancels = useRef<(() => void)[]>([]);
  const widthMotion = useRef({ value: 0, velocity: 0 }), radiusMotion = useRef({ value: 10, velocity: 0 });
  const geometryReady = useRef(false), targets = useRef<{ width: number; radius: number; reserve: number } | null>(null);
  const confirmationIdentity = confirmation?.identity, confirmationCount = confirmation?.count ?? 0, confirmationText = confirmation?.text ?? "";
  useLayoutEffect(() => {
    const received = !!confirmationIdentity && confirmationIdentity !== seen.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (pending && armed.current) setPhase("pending");
    else if (received && confirmationIdentity && armed.current && confirmationCount > 0) {
      seen.current = confirmationIdentity;
      armed.current = false;
      setAcknowledgement({ identity: confirmationIdentity, count: confirmationCount, text: confirmationText });
      if (reducedMotion()) setPhase("confirmed");
      else { setPhase("check"); timer = setTimeout(() => setPhase("confirmed"), 190); }
    } else if (wasPending.current || reviewKey !== previousReview.current) {
      setPhase("idle");
      setAcknowledgement(null);
      if (reviewKey !== previousReview.current) armed.current = false;
    }
    if (received && !pending && !armed.current) seen.current = confirmationIdentity;
    wasPending.current = pending;
    previousReview.current = reviewKey;
    return () => { if (timer) clearTimeout(timer); };
  }, [pending, confirmationIdentity, confirmationCount, confirmationText, reviewKey]);

  useLayoutEffect(() => {
    const button = element.current, frame = footprint.current;
    if (!button || !frame) return;
    const animate = () => {
      const typography = getComputedStyle(button);
      for (const measure of [idleMeasure.current, resultMeasure.current]) {
        if (measure) { measure.style.font = typography.font; measure.style.letterSpacing = typography.letterSpacing; }
      }
      const idleWidth = Math.max(128, (idleMeasure.current?.scrollWidth ?? 128) + 40);
      const resultWidth = Math.max(128, (resultMeasure.current?.scrollWidth ?? 128) + 72);
      const available = frame.parentElement?.clientWidth || Math.max(idleWidth, resultWidth);
      const reserve = Math.min(available, Math.max(idleWidth, resultWidth, 48));
      const circle = phase === "pending" || phase === "check";
      const targetWidth = circle ? 48 : Math.min(reserve, phase === "confirmed" ? resultWidth : idleWidth);
      const targetRadius = circle || phase === "confirmed" ? 24 : 10;
      if (targets.current?.width === targetWidth && targets.current.radius === targetRadius && targets.current.reserve === reserve) return;
      targets.current = { width: targetWidth, radius: targetRadius, reserve };
      cancels.current.forEach(cancel => cancel());
      if (frame.style.width !== `${reserve}px`) frame.style.width = `${reserve}px`;
      if (!geometryReady.current) {
        geometryReady.current = true;
        widthMotion.current.value = button.getBoundingClientRect().width;
        radiusMotion.current.value = Number.parseFloat(getComputedStyle(button).borderRadius) || 10;
      }
      cancels.current = [
        spring(widthMotion.current.value, targetWidth, value => { button.style.width = `${Math.max(48, value)}px`; }, undefined, 28, widthMotion.current),
        spring(radiusMotion.current.value, targetRadius, value => { button.style.borderRadius = `${Math.max(0, value)}px`; }, undefined, 28, radiusMotion.current),
      ];
    };
    animate();
    const observer = new ResizeObserver(animate);
    if (frame.parentElement) observer.observe(frame.parentElement);
    return () => { observer.disconnect(); cancels.current.forEach(cancel => cancel()); targets.current = null; };
  }, [phase, children, acknowledgement?.text]);

  return <span ref={footprint} className={styles.footprint} data-receipt-phase={phase}>
    <span ref={idleMeasure} className={styles.measure} aria-hidden="true">{children}</span>
    <span ref={resultMeasure} className={styles.measure} aria-hidden="true">{acknowledgement?.text || actionLabel}</span>
    <Button {...props} ref={element} className={`${styles.action} ${className || ""}`} aria-label={actionLabel} onClick={event => { armed.current = true; onClick?.(event); }}>
      <span className={styles.accessible}>{children}</span>
      <span className={styles.visual} aria-hidden="true" key={phase}>
        {phase === "pending" ? <LoaderCircle className={styles.loader} size={20}/> : phase === "check" ? <Check size={21}/> : phase === "confirmed" ? <><Check size={18}/><span>{acknowledgement?.text}</span></> : children}
      </span>
    </Button>
    <span className={styles.accessible} role="status" aria-live="polite" aria-atomic="true">{pending ? pendingAnnouncement ?? "" : acknowledgement ? confirmationAnnouncement ?? `${acknowledgement.text}. Confirmed server receipt for ${acknowledgement.count} ${acknowledgement.count === 1 ? "battery" : "batteries"}.` : ""}</span>
  </span>;
}
