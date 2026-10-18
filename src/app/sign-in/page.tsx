"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/components/layout/page-transition";
import { useSession } from "@/lib/stores/session-store";
import { useHref } from "@/lib/routes/use-href";

export default function SignInPage() {
  const toHref = useHref();
  const router = useRouter();
  const setRole = useSession((s) => s.setRole);
  const [email, setEmail] = useState("adnan@techcorp.com");
  const [password, setPassword] = useState("password");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setRole("BDE");
      router.push(toHref("welcome"));
    }, 800);
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

        <p className="mt-6 text-center text-caption text-[var(--color-text-3)]">
          New to BenchQ? <Link href={toHref("sign-up")} className="text-[var(--color-primary)]">Create an account</Link>
        </p>
      </Card>
    </PageTransition>
  );
}
