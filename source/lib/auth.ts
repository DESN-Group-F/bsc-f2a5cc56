import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticationContract } from "./platform/auth-contract";

export type AuthenticatedUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const { headers: identityHeaders, routes: authRoutes } = authenticationContract;

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get(identityHeaders.userId);
  const email = requestHeaders.get(identityHeaders.email);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(identityHeaders.fullName);
  const fullName =
    encodedFullName &&
    requestHeaders.get(identityHeaders.fullNameEncoding) === authenticationContract.fullNameEncoding
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireAuthenticatedUser(
  returnTo: string,
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (user) return user;

  redirect(signInPath(returnTo));
}

export function signInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${authRoutes.signIn}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function signOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${authRoutes.signOut}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === authRoutes.signIn ||
    pathname === authRoutes.signOut ||
    pathname === authRoutes.callback
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
