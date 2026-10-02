import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getD1Database } from "@/db";
import { AccountStore, type StaffUser } from "./accounts";
import { sessionToken } from "./credentials";
import { safeReturnPath } from "./return-path";
export type AuthenticatedUser = StaffUser;
export async function getAuthenticatedUser(): Promise<StaffUser | null> {
    const requestHeaders = await headers();
    return new AccountStore(getD1Database()).authenticate(sessionToken(requestHeaders.get("cookie")));
}
export async function requireAuthenticatedUser(returnTo: string): Promise<StaffUser> {
    const user = await getAuthenticatedUser();
    if (user) return user;
    redirect(signInPath(returnTo));
}
export function signInPath(returnTo: string) {
    const safe = safeReturnPath(returnTo);
    return `/signin?return_to=${encodeURIComponent(safe)}`;
}
