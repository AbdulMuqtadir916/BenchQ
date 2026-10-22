"use client";

import { Suspense, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/components/layout/page-transition";
import { ApiError } from "@/lib/api/client";
import { useSignIn } from "@/lib/hooks/use-session";
import { safeReturnTo } from "@/lib/routes/landing";

/** useSearchParams needs a Suspense boundary for the static build. */
export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

/** Any failed sign-in reads the same, so the page never reveals which emails have an account (docs/07 L1). */
const INVALID = "Email or password is incorrect.";

/**
 * /sign-in (docs/07 §2.1, Phase L): email + password against the seeded accounts (docs/03 §3.2; mock
 * auth until Phase D). On success: back to the same-origin `returnTo`, or the principal's landing.
 */
function SignInForm() {
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const signIn = useSignIn(returnTo);
  const errorId = useId();
  // Prefilled from an accepted invite's link ("Go to sign in" on /invite/[token]).
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    signIn.mutate({ email, password });
  };

  // The generic credential error for a refused sign-in; a different message only when the service
  // itself failed, which says nothing about the account.
  const error = signIn.isError
    ? signIn.error instanceof ApiError && signIn.error.status !== 401
      ? "Couldn't sign in right now. Try again."
      : INVALID
    : null;
  const isBusy = signIn.isPending || signIn.isSuccess;

  return (
    <PageTransition className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <div className="text-center mb-8">
          <h1 className="text-display text-[var(--color-text)]">BenchQ</h1>
          <p className="text-body text-[var(--color-text-3)] mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <label className="text-label text-[var(--color-text-2)]" htmlFor="email">Email</label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              aria-invalid={error === INVALID || undefined}
              aria-describedby={error ? errorId : undefined}
              className="bq-input"
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-label text-[var(--color-text-2)]" htmlFor="password">Password</label>
              <a href="#" className="text-caption text-[var(--color-primary)]">Forgot password?</a>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              aria-invalid={error === INVALID || undefined}
              aria-describedby={error ? errorId : undefined}
              className="bq-input"
            />
          </div>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-[var(--color-danger-fg)]">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="bq-primary w-full mt-4" disabled={isBusy || !email || !password}>
            {isBusy ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </PageTransition>
  );
}
