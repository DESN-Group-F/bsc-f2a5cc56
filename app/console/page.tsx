import type { Metadata } from "next";
import { ManagementConsole } from "@/components/console/management-console";
import { requireAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Battery management | DESN2000",
  description: "Management console for the shared battery inventory: overview, records, recurring checks and administration.",
};

export default async function ConsolePage() {
  const user = await requireAuthenticatedUser("/console");
  return <ManagementConsole initialUser={user} />;
}
