"use client";

import { CalendarDays } from "lucide-react";
import type { TaskGenerationIssue } from "@/lib/task-plans";

export function TaskDeliveryNotice() {
  return (
    <div className="working-notice">
      <CalendarDays size={17} />
      <span>
        <strong>Messages are generated while the system is in use.</strong>{" "}
        Unattended scheduling and email delivery are not connected. Email
        preferences are saved; no email is sent.
      </span>
    </div>
  );
}

export function TaskGenerationWarnings({
  issues,
}: {
  issues: TaskGenerationIssue[];
}) {
  if (!issues.length) return null;
  return (
    <div className="working-notice" role="alert">
      <CalendarDays size={17} />
      <div>
        <strong>Some periodic tasks need administrator review.</strong>
        <ul className="mt-1 list-disc pl-5">
          {issues.map((issue) => (
            <li key={issue.planId}>{issue.message}</li>
          ))}
        </ul>
        <p>
          Review these configurations before relying on their reminders;
          existing task and message history is retained.
        </p>
      </div>
    </div>
  );
}
