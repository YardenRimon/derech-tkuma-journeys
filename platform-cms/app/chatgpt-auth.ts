import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { verifyAccessIdentity, accessDiagnosticsEnabled, ACCESS_DIAGNOSTIC_SCOPE_HEADER, reportAccessFailure, reportAccessHeaderPresence, reportAccessJwksProbe } from "@/lib/cloudflare-access";

// Fixed at build time: a standalone Worker can never opt into Sites headers.
declare const __PLATFORM_AUTH_PROVIDER__: "sites" | "cloudflare-access" | "supabase";
declare const __PLATFORM_AUTH_REQUIRE_MFA__: boolean;
export function getAuthProvider() { return __PLATFORM_AUTH_PROVIDER__; }

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  if (getAuthProvider() === "supabase") {
    // The standalone Worker removes these headers from EVERY external request
    // and creates them only after trusted-provider verification and the fixed MFA policy.
    const userId = requestHeaders.get("x-platform-authenticated-id");
    const email = requestHeaders.get("x-platform-authenticated-email");
    const aal = requestHeaders.get("x-platform-authenticated-aal");
    if (!userId || !email || (aal !== "aal1" && aal !== "aal2") || (__PLATFORM_AUTH_REQUIRE_MFA__ && aal !== "aal2")) return null;
    const fullName = safeDecodeURIComponent(requestHeaders.get("x-platform-authenticated-name") ?? "") || null;
    return { userId, email, displayName: fullName ?? email, fullName };
  }
  if (getAuthProvider() === "cloudflare-access") {
    const settings = env as unknown as { CF_ACCESS_ISSUER?: string; CF_ACCESS_AUDIENCE?: string; PLATFORM_RELEASE_STAGE?: string; CF_ACCESS_DIAGNOSTICS?: string };
    const diagnose = accessDiagnosticsEnabled(settings) && requestHeaders.get(ACCESS_DIAGNOSTIC_SCOPE_HEADER) === "1";
    if (diagnose) reportAccessHeaderPresence("app", requestHeaders.has("cf-access-jwt-assertion"));
    return verifyAccessIdentity(requestHeaders.get("cf-access-jwt-assertion") ?? "", {
      issuer: settings.CF_ACCESS_ISSUER ?? "", audience: settings.CF_ACCESS_AUDIENCE ?? "",
    }, diagnose ? { onFailure: reportAccessFailure, onJwksProbe: reportAccessJwksProbe } : {});
  }
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  if (getAuthProvider() === "supabase") return `/login/?next=${encodeURIComponent(safeReturnTo)}`;
  if (getAuthProvider() === "cloudflare-access") return `/auth-required?return_to=${encodeURIComponent(safeReturnTo)}`;
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  if (getAuthProvider() === "supabase") return "/login/?logout=1";
  if (getAuthProvider() === "cloudflare-access") return "/cdn-cgi/access/logout";
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
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
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
