"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/components/layout/page-transition";
import { useHref } from "@/lib/routes/use-href";

/** docs/04 §2.1. No real auth yet (Module 00 Part C): submission is simulated. */

const SignUpForm = z.object({
  fullName: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().email("Enter a valid work email."),
  firmName: z.string().trim().min(2, "Enter your firm's name."),
  password: z.string().min(8, "Use at least 8 characters."),
});
type SignUpForm = z.infer<typeof SignUpForm>;
type FieldErrors = Partial<Record<keyof SignUpForm, string>>;

const TAKEN_EMAIL = "taken@benchq.io";

export default function SignUpPage() {
  const toHref = useHref();
  const [form, setForm] = useState<SignUpForm>({ fullName: "", email: "", firmName: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const update = (key: keyof SignUpForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setFieldErrors((errors) => ({ ...errors, [key]: undefined }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = SignUpForm.safeParse(form);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SignUpForm;
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      if (parsed.data.email.toLowerCase() === TAKEN_EMAIL) {
        setFormError("An account with this email already exists. Sign in instead.");
        return;
      }
      setSentTo(parsed.data.email);
    }, 800);
  };

  if (sentTo) {
    return (
      <PageTransition className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 shadow-lg text-center">
          <span aria-hidden className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-success-bg)] text-[var(--color-success-fg)]">
            <MailCheck size={22} />
          </span>
          <h1 className="text-h2 text-[var(--color-text)]">Check your email</h1>
          <p className="mt-2 text-body text-[var(--color-text-2)]">
            We sent a confirmation link to <span className="text-body-strong">{sentTo}</span>. Open it to finish setting up your firm.
          </p>
          <Button asChild variant="secondary" className="mt-6">
            <Link href={toHref("sign-in")}>Back to sign in</Link>
          </Button>
        </Card>
      </PageTransition>
    );
  }

  return (
    <PageTransition className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <div className="text-center mb-8">
          <h1 className="text-display text-[var(--color-text)]">BenchQ</h1>
          <p className="text-body text-[var(--color-text-3)] mt-2">Create your firm&rsquo;s account</p>
        </div>

        {formError ? (
          <div role="alert" className="mb-4 rounded-[var(--radius-md)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field id="fullName" label="Full name" error={fieldErrors.fullName}>
            <Input id="fullName" autoComplete="name" value={form.fullName} onChange={update("fullName")} aria-invalid={!!fieldErrors.fullName} aria-describedby={fieldErrors.fullName ? "fullName-error" : undefined} className="bq-input" />
          </Field>
          <Field id="email" label="Work email" error={fieldErrors.email}>
            <Input id="email" type="email" autoComplete="email" value={form.email} onChange={update("email")} aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? "email-error" : undefined} className="bq-input" />
          </Field>
          <Field id="firmName" label="Firm name" error={fieldErrors.firmName}>
            <Input id="firmName" autoComplete="organization" value={form.firmName} onChange={update("firmName")} aria-invalid={!!fieldErrors.firmName} aria-describedby={fieldErrors.firmName ? "firmName-error" : undefined} className="bq-input" />
          </Field>
          <Field id="password" label="Password" error={fieldErrors.password}>
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={update("password")} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? "password-error" : undefined} className="bq-input" />
          </Field>
          <Button type="submit" className="bq-primary w-full mt-4" disabled={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-caption text-[var(--color-text-3)]">
          Already have an account? <Link href={toHref("sign-in")} className="text-[var(--color-primary)]">Sign in</Link>
        </p>
      </Card>
    </PageTransition>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-label text-[var(--color-text-2)]" htmlFor={id}>{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="text-caption text-[var(--color-danger-fg)]">{error}</p> : null}
    </div>
  );
}
