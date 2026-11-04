import type { Metadata } from "next";
import { parseNfcHandoff } from "@/lib/nfc-handoff";
import NfcTest from "./nfc-test";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "NFC test | Battery Inventory",
  description: "Read-only NFC identifier testing against the demonstration inventory.",
  robots: { index: false, follow: false },
};

/** Public shell only. Staff data is requested after same-origin authentication. */
export default async function NfcTestPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supplied = await searchParams;
  const query = new URLSearchParams();
  for (const name of ["dataset", "tagId"]) {
    const value = supplied[name];
    if (Array.isArray(value)) for (const entry of value) query.append(name, entry);
    else if (value !== undefined) query.append(name, value);
  }
  const handoff = parseNfcHandoff(query.toString());
  return <NfcTest key={query.toString()} initialHandoff={handoff} />;
}
