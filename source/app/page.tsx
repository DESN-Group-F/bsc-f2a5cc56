import InventoryApp from "./inventory-app";
import { requireAuthenticatedUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Home() {
    await requireAuthenticatedUser("/");
    return <InventoryApp />;
}
