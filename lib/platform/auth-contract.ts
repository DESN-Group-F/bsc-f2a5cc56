// External hosting protocol identifiers. Keep these values stable when
// changing application names; the hosting dispatcher owns these routes.
export const authenticationContract = {
  headerPrefix: "oai-authenticated-user-",
  headers: {
    userId: "oai-authenticated-user-id",
    email: "oai-authenticated-user-email",
    fullName: "oai-authenticated-user-full-name",
    fullNameEncoding: "oai-authenticated-user-full-name-encoding",
  },
  fullNameEncoding: "percent-encoded-utf-8",
  routes: {
    signIn: "/signin-with-chatgpt",
    signOut: "/signout-with-chatgpt",
    callback: "/callback",
  },
} as const;
