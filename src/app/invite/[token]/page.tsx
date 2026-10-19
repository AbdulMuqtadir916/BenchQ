"use client";

import Link from "next/link";
import { use, useId, useState, type FormEvent } from "react";
import { CircleAlert, CirclePause, Clock, MailCheck, MailX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/app/error-state";
import { PageTransition } from "@/components/layout/page-transition";
import { ApiError } from "@/lib/api/client";
import type { InviteLookup } from "@/lib/api/invites";
import { useAcceptInvite, useInviteLookup } from "@/lib/hooks/use-invite";
import { hrefFor } from "@/lib/routes/registry";
import { useSession } from "@/lib/stores/session-store";

/** docs/04 §2.1 / 07 P4: the same as the mock's MIN_PASSWORD_LENGTH (the backend re-checks). */
const MIN_PASSWORD = 8;

type InviteDetails = Extract<InviteLookup, { email: string }>;

const ROLE_LABEL: Record<InviteDetails["role"], string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  BDE: "BDE",
  VIEWER: "Viewer",
  PLATFORM_ADMIN: "Super Admin (BenchQ staff)",
};

/**
 * /invite/[token] (docs/04 §2.1, 07 P4, Q26): the firm and the offered role, then the person sets their
 * name (prefilled from the invite, Q31) and a password. Accepting creates the account and signs it in:
 * an OWNER lands on /welcome, others on their landing. Every state the link can be in has its own screen.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const lookup = useInviteLookup(token);

  return (
    <PageTransition className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <p className="mb-6 text-center text-h3 text-[var(--color-text)]">BenchQ</p>
        {lookup.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading the invite" className="space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : lookup.isError ? (
          <ErrorState error={lookup.error} onRetry={() => void lookup.refetch()} />
        ) : lookup.data.status === "VALID" ? (
          <AcceptForm token={token} invite={lookup.data} />
        ) : (
          <Blocked lookup={lookup.data} />
        )}
      </Card>
    </PageTransition>
  );
}

function Blocked({ lookup }: { lookup: InviteLookup }) {
  const where = "firmName" in lookup && lookup.firmName ? lookup.firmName : "BenchQ";
  const screens = {
    INVALID: { Icon: MailX, title: "This invite link isn't valid", body: "It may have been replaced by a newer invite. Use the latest link you were sent, or ask the person who invited you to resend it." },
    EXPIRED: { Icon: Clock, title: "This invite has expired", body: `Invites last 7 days. Ask the person who invited you to ${where} to resend it.` },
    REVOKED: { Icon: MailX, title: "This invite was revoked", body: `It no longer gives access to ${where}. If that's a mistake, ask the person who invited you.` },
    ACCEPTED: { Icon: MailCheck, title: "This invite has already been accepted", body: "Sign in with the email and password you chose." },
    SUSPENDED: { Icon: CirclePause, title: "Workspace suspended", body: `${where} is suspended, so this invite can't be accepted right now. It stays valid until it expires.` },
  } as const;
  const { Icon, title, body } = screens[lookup.status as keyof typeof screens];
  return (
    <div className="text-center">
      <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-2)]" aria-hidden>
        <Icon size={22} />
      </span>
      <h1 className="text-h2 text-[var(--color-text)]">{title}</h1>
      <p className="mt-2 text-body text-[var(--color-text-2)]">{body}</p>
      <Button asChild variant="secondary" className="mt-6">
        <Link href={hrefFor("sign-in")}>Go to sign in</Link>
      </Button>
    </div>
  );
}

function AcceptForm({ token, invite }: { token: string; invite: InviteDetails }) {
  const accept = useAcceptInvite(token);
  const signedInAs = useSession((s) => s.user?.name ?? s.platformUser?.name ?? null);
  const [name, setName] = useState(invite.inviteeName ?? "");
  const [password, setPassword] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const nameId = useId();
  const passwordId = useId();
  const nameError = isSubmitted && !name.trim() ? "Enter your name." : null;
  const passwordError = isSubmitted && password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : null;
  const isBusy = accept.isPending || accept.isSuccess;
  const failure = accept.isError ? (accept.error instanceof ApiError ? accept.error.message : "Couldn't accept the invite right now. Try again.") : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitted(true);
    if (!name.trim() || password.length < MIN_PASSWORD || isBusy) return;
    accept.mutate({ name, password });
  }

  return (
    <>
      <h1 className="text-h2 text-[var(--color-text)]">{invite.firmName ? `Join ${invite.firmName}` : "Join the BenchQ team"}</h1>
      <p className="mt-1 text-body text-[var(--color-text-2)]">
        You&apos;re invited as <strong className="text-[var(--color-text)]">{ROLE_LABEL[invite.role]}</strong>.
      </p>
      {signedInAs ? (
        <p className="mt-4 flex gap-2 rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning-fg)]">
          <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
          You&apos;re signed in as {signedInAs} in this browser. Accepting signs you in as the new account instead.
        </p>
      ) : null}
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <span className="text-label text-[var(--color-text-2)]">Email</span>
          <p className="text-body text-[var(--color-text)]">{invite.email}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={nameId} className="text-label text-[var(--color-text-2)]">Your name</label>
          <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${nameId}-error` : undefined} />
          {nameError ? <p id={`${nameId}-error`} className="text-caption text-[var(--color-danger-fg)]">{nameError}</p> : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={passwordId} className="text-label text-[var(--color-text-2)]">Choose a password</label>
          <Input
            id={passwordId}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={`${passwordId}-hint`}
          />
          <p id={`${passwordId}-hint`} className={passwordError ? "text-caption text-[var(--color-danger-fg)]" : "text-caption text-[var(--color-text-3)]"}>
            {passwordError ?? `At least ${MIN_PASSWORD} characters.`}
          </p>
        </div>
        {failure ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{failure}</p> : null}
        <Button type="submit" className="bq-primary w-full" disabled={isBusy}>
          {isBusy ? "Joining…" : "Accept and join"}
        </Button>
      </form>
    </>
  );
}
