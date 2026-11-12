"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState } from "@/components/app/error-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { slugProblem, suggestSlug } from "@/lib/derive/platform";
import { CANDIDATES_PER_SEAT, candidateLimitFor, formatUsd, periodAmountCents } from "@/lib/derive/billing";
import { useCreateFirm, usePlans, usePlatformFirms } from "@/lib/hooks/use-platform";
import { queryGroup } from "@/lib/query/query-group";
import { useHref } from "@/lib/routes/use-href";
import { useShowToast } from "@/lib/stores/toast-store";
import { AdminDialog, Field, errorMessage, fieldAria } from "../admin-dialog";
import { SlugField } from "../slug-field";
import { TIMEZONES } from "../timezones";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Form {
  name: string;
  slug: string;
  planId: string;
  seatLimit: string;
  candidateLimit: string;
  primaryTimezone: string;
  clientTimezone: string;
  contactPhone: string;
  ownerName: string;
  ownerEmail: string;
}

const EMPTY: Form = { name: "", slug: "", planId: "", seatLimit: "", candidateLimit: "", primaryTimezone: "Asia/Kolkata", clientTimezone: "America/New_York", contactPhone: "", ownerName: "", ownerEmail: "" };

/**
 * /admin/firms/new (docs/04 §14.4). Creates the firm (ONBOARDING) with a BDE count (the plan's by default; 10 candidates
 * per BDE follow, 07 Q64) and the plan's price copied, and
 * the OWNER's 7-day invite. Application expiry takes its default: the OWNER
 * changes them in settings/firm. Esc or Cancel goes back to the list, confirming if anything was typed.
 */
export function CreateFirm() {
  const router = useRouter();
  const toHref = useHref();
  const showToast = useShowToast();
  const firms = usePlatformFirms();
  const plans = usePlans();
  const group = queryGroup(firms, plans);
  const create = useCreateFirm();
  const [form, setForm] = useState<Form>(EMPTY);
  const [isSlugEdited, setIsSlugEdited] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const activePlans = useMemo(() => (plans.data ?? []).filter((plan) => plan.isActive), [plans.data]);
  const planId = form.planId || activePlans[0]?.id || "";
  const plan = activePlans.find((item) => item.id === planId);
  // Once created, the firms list refetches with this firm in it: stop checking until the page has moved on.
  const taken = useMemo(() => (create.isSuccess ? [] : (firms.data ?? []).map((firm) => firm.slug)), [firms.data, create.isSuccess]);
  const isEdited = JSON.stringify(form) !== JSON.stringify(EMPTY);

  const seatsText = form.seatLimit.trim();
  const seats = seatsText === "" ? (plan?.seatLimit ?? 0) : /^\d+$/.test(seatsText) ? Number(seatsText) : Number.NaN;
  const candidatesText = form.candidateLimit.trim();
  const candidates = candidatesText === "" ? candidateLimitFor(seats) : /^\d+$/.test(candidatesText) ? Number(candidatesText) : Number.NaN;
  const errors = {
    name: form.name.trim() ? null : "Enter the firm's name.",
    slug: slugProblem(form.slug, taken),
    planId: plan ? null : "Choose a plan.",
    seatLimit: seatsText === "" || (Number.isInteger(seats) && seats >= 1 && seats <= 1000) ? null : "A whole number from 1 to 1000.",
    candidateLimit: candidatesText === "" || (Number.isInteger(candidates) && candidates <= 100000) ? null : "A whole number from 0 to 100000.",
    ownerName: form.ownerName.trim() ? null : "Enter the owner's name.",
    ownerEmail: EMAIL.test(form.ownerEmail.trim()) ? null : "Enter a valid email address.",
  };
  const isValid = Object.values(errors).every((error) => error === null);
  const shown = (key: keyof typeof errors) => (isSubmitted ? errors[key] : null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const leave = useCallback(() => router.push(toHref("admin.firms")), [router, toHref]);
  const cancel = useCallback(() => (isEdited ? setIsDiscarding(true) : leave()), [isEdited, leave]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector("dialog[open]") && !create.isPending) cancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, create.isPending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitted(true);
    if (!isValid || create.isPending) return;
    create.mutate(
      { ...form, planId, seatLimit: seatsText === "" ? undefined : seats, candidateLimit: candidatesText === "" ? undefined : candidates, contactPhone: form.contactPhone.trim() || null },
      {
        onSuccess: (firm) => {
          showToast(`Firm created. Invite sent to ${form.ownerEmail.trim().toLowerCase()}.`);
          router.push(toHref("admin.firms.detail", { firmId: firm.id }));
        },
      },
    );
  }

  return (
    <div className="bq-page max-w-3xl">
      <Link href={toHref("admin.firms")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} aria-hidden /> Firms
      </Link>
      <PageHeader title="New firm" subtitle="The firm starts as onboarding; it goes active when its owner accepts the invite." />

      {group.status === "error" ? (
        <ErrorState error={group.error} onRetry={group.retry} />
      ) : group.status === "pending" ? (
        <SkeletonCard aria-label="Loading the form" />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-6">
          <Card className="space-y-4">
            <h2 className="text-h3 text-[var(--color-text)]">Firm</h2>
            <Field id="firm-name" label="Firm name" error={shown("name")}>
              <Input
                {...fieldAria("firm-name", shown("name"))}
                value={form.name}
                autoFocus
                onChange={(event) => {
                  const name = event.target.value;
                  setForm((current) => ({ ...current, name, slug: isSlugEdited ? current.slug : suggestSlug(name) }));
                }}
              />
            </Field>
            <SlugField
              id="firm-slug"
              value={form.slug}
              taken={taken}
              showError={isSubmitted}
              onChange={(slug) => {
                setIsSlugEdited(true);
                set("slug", slug);
              }}
            />
            <Field
              id="firm-plan"
              label="Plan"
              error={shown("planId")}
              hint={plan ? `Price copied onto the firm: ${formatUsd(plan.priceCentsPerSeat)} per BDE.` : "No plan is offered to new firms."}
            >
              <select {...fieldAria("firm-plan", shown("planId"), true)} value={planId} onChange={(event) => set("planId", event.target.value)} className="bq-input w-full">
                {activePlans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field
              id="firm-seats"
              label="BDEs"
              error={shown("seatLimit")}
              hint={plan && !errors.seatLimit ? `${formatUsd(periodAmountCents(seats, plan.priceCentsPerSeat))} for 30 days` : undefined}
            >
              <Input {...fieldAria("firm-seats", shown("seatLimit"))} inputMode="numeric" placeholder={plan ? String(plan.seatLimit) : undefined} value={form.seatLimit} onChange={(event) => set("seatLimit", event.target.value)} />
            </Field>
            <Field
              id="firm-candidates"
              label="Candidate limit"
              error={shown("candidateLimit")}
              hint={`How many candidates can be assigned to BDEs. Leave empty for ${CANDIDATES_PER_SEAT} per BDE (${candidateLimitFor(seats)}).`}
            >
              <Input {...fieldAria("firm-candidates", shown("candidateLimit"))} inputMode="numeric" placeholder={String(candidateLimitFor(seats))} value={form.candidateLimit} onChange={(event) => set("candidateLimit", event.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="firm-tz" label="Primary timezone">
                <select id="firm-tz" value={form.primaryTimezone} onChange={(event) => set("primaryTimezone", event.target.value)} className="bq-input w-full">
                  {TIMEZONES.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                </select>
              </Field>
              <Field id="firm-client-tz" label="Client timezone">
                <select id="firm-client-tz" value={form.clientTimezone} onChange={(event) => set("clientTimezone", event.target.value)} className="bq-input w-full">
                  {TIMEZONES.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                </select>
              </Field>
            </div>
            <Field id="firm-phone" label="Contact phone (optional)">
              <Input id="firm-phone" type="tel" value={form.contactPhone} onChange={(event) => set("contactPhone", event.target.value)} autoComplete="off" />
            </Field>
          </Card>

          <Card className="space-y-4">
            <div>
              <h2 className="text-h3 text-[var(--color-text)]">Owner</h2>
              <p className="mt-1 text-sm text-[var(--color-text-3)]">They get an invite valid for 7 days, and set up the rest of the firm.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="owner-name" label="Owner name" error={shown("ownerName")}>
                <Input {...fieldAria("owner-name", shown("ownerName"))} value={form.ownerName} onChange={(event) => set("ownerName", event.target.value)} autoComplete="off" />
              </Field>
              <Field id="owner-email" label="Owner email" error={shown("ownerEmail")}>
                <Input {...fieldAria("owner-email", shown("ownerEmail"))} type="email" value={form.ownerEmail} onChange={(event) => set("ownerEmail", event.target.value)} autoComplete="off" />
              </Field>
            </div>
          </Card>

          {create.isError ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{errorMessage(create.error)}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={cancel} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || create.isSuccess || activePlans.length === 0}>{create.isPending || create.isSuccess ? "Creating…" : "Create firm and send invite"}</Button>
          </div>
        </form>
      )}

      <AdminDialog
        open={isDiscarding}
        onClose={() => setIsDiscarding(false)}
        title="Discard this firm?"
        description={<p>What you typed here is lost. No firm is created and no invite is sent.</p>}
        confirmLabel="Discard"
        pendingLabel="Discarding…"
        tone="danger"
        onConfirm={leave}
      />
    </div>
  );
}
