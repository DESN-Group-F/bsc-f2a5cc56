import type { InventorySnapshot } from "@/lib/domain";
import type {
  TaskPlanRecord,
  TaskCycleRecord,
  TaskGenerationIssue,
} from "@/lib/task-plans";
import { reloadSessionPage } from "@/lib/client-utils";

export type TaskCapabilities = {
  schedulerAvailable: boolean;
  emailAvailable: boolean;
  messageGeneration: string;
  note: string;
};

export type TaskPlansResponse = {
  plans: TaskPlanRecord[];
  cycles: TaskCycleRecord[];
  staffDirectory: InventorySnapshot["staffDirectory"];
  capabilities: TaskCapabilities;
  generationIssues: TaskGenerationIssue[];
};

export type RequestError = Error & { status?: number; code?: string };

export async function taskRequest<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (response.status === 401) reloadSessionPage("/signin");
  let body: T & { error?: string; code?: string };
  try {
    body = await response.json();
  } catch {
    throw Object.assign(
      new Error(
        "The response was interrupted. Your input is preserved; review the saved records before retrying.",
      ),
      { status: response.status },
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(body.error || "The task operation could not be completed."),
      { status: response.status, code: body.code },
    );
  return body;
}
