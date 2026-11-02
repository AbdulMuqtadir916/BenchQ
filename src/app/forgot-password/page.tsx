"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useHref } from "@/lib/routes/use-href";
import { passwordRecoveryApi } from "@/lib/api/password-recovery";

export default function ForgotPasswordPage() {
  const toHref = useHref();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await passwordRecoveryApi.request(email);
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't submit the request right now. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4"><Card className="w-full max-w-xl p-8 shadow-lg">
    <div className="text-center mb-8"><h1 className="text-display text-[var(--color-text)]">BenchQ</h1><h2 className="mt-5 text-xl font-semibold text-[var(--color-text)]">Reset your password</h2><p className="mt-2 text-[var(--color-text-3)]">Enter the email address on your BenchQ account.</p></div>
    {sent ? <p role="status" className="text-sm text-[var(--color-text)]">If the account is eligible, its approver will see a reset request in Notifications. Contact your manager or owner for the link.</p> : <form onSubmit={submit} className="space-y-4"><label className="block space-y-2 text-label text-[var(--color-text-2)]">Email<Input type="email" autoComplete="email" required maxLength={320} value={email} onChange={e => setEmail(e.target.value)} className="bq-input" /></label>{error && <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{error}</p>}<Button type="submit" className="bq-primary w-full" disabled={busy || !email}>{busy ? "Sending..." : "Send reset request"}</Button></form>}
    <div className="mt-7 text-center"><Link href={toHref("sign-in")} className="text-caption text-[var(--color-primary)]">Back to sign in</Link></div>
  </Card></main>;
}
