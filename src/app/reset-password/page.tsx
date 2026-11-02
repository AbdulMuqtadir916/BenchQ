"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useHref } from "@/lib/routes/use-href";
import { passwordRecoveryApi } from "@/lib/api/password-recovery";

const RESET_TOKEN_KEY = "benchq.reset-password.token";
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export default function ResetPasswordPage() {
  const toHref = useHref();
  const tokenInitialized = useRef(false);
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function clearStoredToken() {
    try { window.sessionStorage.removeItem(RESET_TOKEN_KEY); } catch { /* Storage may be disabled. */ }
  }
  useEffect(() => {
    const applyToken = (raw: string) => {
      setToken(raw);
      setTokenReady(true);
    };
    const storeToken = (raw: string) => {
      try {
        window.sessionStorage.setItem(RESET_TOKEN_KEY, JSON.stringify({ token: raw, storedAt: Date.now() }));
      } catch {
        // The in-memory token still works if this browser blocks session storage.
      }
      applyToken(raw);
    };
    const consumeHash = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      tokenInitialized.current = true;
      // Keep the token in this tab in case the router remounts this page after replaceState.
      storeToken(raw);
      // Keep the one-use secret out of the address bar and browser history after capturing it.
      window.history.replaceState(window.history.state, "", window.location.pathname);
    };
    window.addEventListener("hashchange", consumeHash);
    // Strict Mode replays effects in development. Read the initial hash only once; later pasted
    // links can update the fragment on this same page and are handled by the listener above.
    if (!tokenInitialized.current) {
      tokenInitialized.current = true;
      if (window.location.hash) consumeHash();
      else {
        let restoredToken = "";
        try {
          const saved = window.sessionStorage.getItem(RESET_TOKEN_KEY);
          if (saved) {
            const parsed: unknown = JSON.parse(saved);
            const tokenAge = typeof parsed === "object" && parsed !== null && "storedAt" in parsed
              && typeof parsed.storedAt === "number" ? Date.now() - parsed.storedAt : -1;
            if (typeof parsed === "object" && parsed !== null
                && "token" in parsed && typeof parsed.token === "string"
                && "storedAt" in parsed && typeof parsed.storedAt === "number"
                && tokenAge >= 0 && tokenAge < RESET_TOKEN_TTL_MS) {
              restoredToken = parsed.token;
            } else {
              window.sessionStorage.removeItem(RESET_TOKEN_KEY);
            }
          }
        } catch {
          clearStoredToken();
        }
        applyToken(restoredToken);
      }
    }
    return () => window.removeEventListener("hashchange", consumeHash);
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await passwordRecoveryApi.complete(token, password);
      clearStoredToken();
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't reset your password. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4"><Card className="w-full max-w-xl p-8 shadow-lg">
    <div className="text-center mb-8"><h1 className="text-display text-[var(--color-text)]">BenchQ</h1><h2 className="mt-5 text-xl font-semibold text-[var(--color-text)]">Choose a new password</h2><p className="mt-2 text-[var(--color-text-3)]">Your approver shared this one-time reset link with you.</p></div>
    {done ? <div><p role="status">Password reset successfully. You can now sign in.</p><Link className="mt-5 block text-center text-caption text-[var(--color-primary)]" href={toHref("sign-in")}>Go to sign in</Link></div> : <form onSubmit={submit} className="space-y-4"><label className="block space-y-2 text-label text-[var(--color-text-2)]">New password<Input type="password" autoComplete="new-password" minLength={8} maxLength={1024} required value={password} onChange={e => setPassword(e.target.value)} className="bq-input" /></label><label className="block space-y-2 text-label text-[var(--color-text-2)]">Confirm new password<Input type="password" autoComplete="new-password" minLength={8} maxLength={1024} required value={confirm} onChange={e => setConfirm(e.target.value)} className="bq-input" /></label>{password && confirm && password !== confirm && <p className="text-sm text-[var(--color-danger-fg)]">Passwords do not match.</p>}{error && <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{error}</p>}<Button type="submit" className="bq-primary w-full" disabled={busy || !tokenReady || !token || password.length < 8 || password !== confirm}>{busy ? "Resetting..." : "Reset password"}</Button>{tokenReady && !token && <p role="alert" className="text-sm text-[var(--color-danger-fg)]">Reset token is missing. Ask your approver for a fresh link.</p>}</form>}
  </Card></main>;
}
