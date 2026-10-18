"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/components/layout/page-transition";
import { DEFAULT_SESSION } from "@/lib/stores/session-store";
import { useDevSignInAs } from "@/lib/hooks/use-session";
import { hrefFor } from "@/lib/routes/registry";
import { safeReturnTo } from "@/lib/routes/landing";

/** useSearchParams needs a Suspense boundary for the static build. */
export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  // Navigate first, then the session changes (the change remounts the app, which would drop a
  // callback passed to mutate()).
  const signIn = useDevSignInAs({ navigateTo: () => returnTo ?? hrefFor("root") });
  const [email, setEmail] = useState("adnan@techcorp.com");
  const [password, setPassword] = useState("password");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // No real auth yet: signing in means "the default fixture user" (mock backend and client session).
    // Then back to where the firm gate sent us from, or the landing (docs/07 §2.1).
    signIn.mutate(DEFAULT_SESSION.user.id, { onError: () => setLoading(false) });
  };

  return (
    <PageTransition className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <div className="text-center mb-8">
          <h1 className="text-display text-[var(--color-text)]">BenchQ</h1>
          <p className="text-body text-[var(--color-text-3)] mt-2">Sign in to your account</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-label text-[var(--color-text-2)]" htmlFor="email">Email</label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required className="bq-input" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-label text-[var(--color-text-2)]" htmlFor="password">Password</label>
              <a href="#" className="text-caption text-[var(--color-primary)]">Forgot password?</a>
            </div>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required className="bq-input" />
          </div>
          <Button type="submit" className="bq-primary w-full mt-4" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </PageTransition>
  );
}
