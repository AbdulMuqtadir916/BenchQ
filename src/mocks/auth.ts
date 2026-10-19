import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import type { Principal, PlatformUser } from "@/lib/schemas/tenancy";
import type { Firm, User } from "@/lib/schemas/session";
import { allUsers, firms } from "./team-data";
import { platformUsers } from "./tenancy";
import { changed, table } from "./db";

/**
 * The mock backend's sign-in state (docs/07 Phase L, Q25–Q27): who the "server" thinks is signed in.
 * Accounts are the seeded fixture users and platform admins (docs/03 §3.2), all with one demo
 * password. The session — the signed-in account's id — is kept in `localStorage`, standing in for the
 * session cookie: it survives a reload and is shared by every tab. Mock auth, not security (Phase D).
 */

/** docs/03 §3.2: the one demo password every seeded account signs in with. Mock layer only. */
export const DEMO_PASSWORD = "benchq-demo-2026";

/**
 * Passwords set by people who joined through an invite (07 P4): the seeded accounts keep the demo
 * password; an account created by accepting signs in with the password it chose. Mock only — kept in the
 * demo data so the account works after a reload; never a real credential store (Phase D).
 */
const CredentialSchema = z.object({ accountId: z.string(), password: z.string() });
const credentials = table("credentials", CredentialSchema, () => []);

/** docs/04 §2.1: the minimum length of a password chosen on /invite/[token]. */
export const MIN_PASSWORD_LENGTH = 8;

export function setPassword(accountId: string, password: string): void {
  const index = credentials.findIndex((item) => item.accountId === accountId);
  if (index >= 0) credentials[index] = { accountId, password };
  else credentials.push({ accountId, password });
  changed("credentials");
}

function passwordMatches(accountId: string, password: string): boolean {
  const own = credentials.find((item) => item.accountId === accountId);
  return own ? own.password === password : password === DEMO_PASSWORD;
}

/** The stand-in for the session cookie (Q27). Only this module reads or writes it. */
const SESSION_KEY = "benchq.session";

/** The same, never-varying answer for every failed sign-in: it must not reveal which emails exist. */
const INVALID_CREDENTIALS = () => new ApiError("Email or password is incorrect.", "INVALID_CREDENTIALS", 401);

/** Where the session lives when there is no browser storage (tests, a blocked storage). */
let memorySession: string | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readSession(): string | null {
  const store = storage();
  if (!store) return memorySession;
  try {
    return store.getItem(SESSION_KEY);
  } catch {
    return memorySession;
  }
}

function writeSession(accountId: string | null): void {
  memorySession = accountId;
  const store = storage();
  if (!store) return;
  try {
    if (accountId) store.setItem(SESSION_KEY, accountId);
    else store.removeItem(SESSION_KEY);
  } catch {
    // storage blocked: the session lasts as long as this page
  }
}

export function userById(userId: string): User {
  const user = allUsers.find((item) => item.id === userId);
  if (!user) throw new ApiError("That user can't sign in here.", "UNKNOWN_USER", 400);
  return user;
}

function platformUserById(userId: string): PlatformUser | null {
  return platformUsers.find((item) => item.id === userId) ?? null;
}

export function firmById(firmId: string): Firm {
  const firm = firms.find((item) => item.id === firmId);
  if (!firm) throw new ApiError(`Firm ${firmId} not found.`, "NOT_FOUND", 404);
  return firm;
}

/**
 * The signed-in account, or null. A stored id the (freshly reset) mock data doesn't have, or an account
 * deactivated since, ends the session, as a server would refuse a stale cookie.
 */
function signedInAccount(): { kind: "firm"; user: User } | { kind: "platform"; admin: PlatformUser } | null {
  const id = readSession();
  if (!id) return null;
  const admin = platformUserById(id);
  if (admin?.isActive) return { kind: "platform", admin };
  const user = allUsers.find((item) => item.id === id);
  if (user?.isActive) return { kind: "firm", user };
  writeSession(null);
  return null;
}

export function isSignedIn(): boolean {
  return signedInAccount() !== null;
}

function requireAccount() {
  const account = signedInAccount();
  if (!account) throw new ApiError("Sign in to continue.", "UNAUTHENTICATED", 401);
  return account;
}

export function currentPrincipal(): Principal {
  const account = requireAccount();
  if (account.kind === "platform") return { kind: "platform", userId: account.admin.id, role: "PLATFORM_ADMIN", support: null };
  const { user } = account;
  return { kind: "firm", userId: user.id, firmId: user.firmId, role: user.role };
}

/** The signed-in firm user (the actor of a firm mutation). A platform admin never acts as one (Q10). */
export function currentUser(): User {
  const account = requireAccount();
  if (account.kind === "platform") throw new ApiError("A platform admin can't act inside a firm.", "FORBIDDEN", 403);
  return account.user;
}

/** The signed-in platform admin. */
export function currentPlatformUser(): PlatformUser {
  const account = requireAccount();
  if (account.kind !== "platform") throw new ApiError("Platform admins only.", "FORBIDDEN", 403);
  return account.admin;
}

/**
 * Sign in with email + password (docs/07 L1). Emails match case-insensitively. An unknown email, a
 * wrong password and a deactivated account all fail with the same error, so a caller can't learn which
 * accounts exist.
 */
export function signInWithPassword(email: string, password: string): Principal {
  const address = email.trim().toLowerCase();
  const admin = platformUsers.find((item) => item.email.toLowerCase() === address);
  const user = admin ? null : allUsers.find((item) => item.email.toLowerCase() === address);
  const account = admin ?? user;
  if (!account || !account.isActive || !passwordMatches(account.id, password)) throw INVALID_CREDENTIALS();
  writeSession(account.id);
  return currentPrincipal();
}

/** Sign an account in without a password: right after it accepted an invite (07 P4). */
export function startSession(accountId: string): Principal {
  writeSession(accountId);
  return currentPrincipal();
}

/** End the session, in every tab (they share it, Q27). */
export function signOut(): void {
  writeSession(null);
}

/**
 * Call `onChange` when another tab signs in, out or as someone else (the `storage` event fires only in
 * the other tabs). This tab then asks for the current session again.
 */
export function watchSession(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const listener = (event: Event) => {
    const key = (event as Event & { key?: string | null }).key;
    // key null = the whole storage was cleared
    if (key === SESSION_KEY || key === null) onChange();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
