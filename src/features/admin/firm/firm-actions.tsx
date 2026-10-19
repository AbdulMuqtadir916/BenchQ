"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useChangeSlug, useReactivateFirm, useSuspendFirm, useUpdateFirm, usePlatformFirms } from "@/lib/hooks/use-platform";
import { slugProblem } from "@/lib/derive/platform";
import type { Firm } from "@/lib/schemas/session";
import { AdminDialog, Field, errorMessage, fieldAria } from "../admin-dialog";
import { SlugField } from "../slug-field";
import { timezoneOptions } from "../timezones";

/** The header dialogs of a firm page (docs/04 §14.5). Each closes on success; failures stay in the dialog. */

type DialogProps = { firm: Firm; open: boolean; onClose: () => void };

/** Edit: name, contact phone, timezones. Logs UPDATE with what changed. */
export function EditFirmDialog({ firm, open, onClose }: DialogProps) {
  const update = useUpdateFirm(firm.id);
  const [form, setForm] = useState({ name: firm.name, contactPhone: firm.contactPhone ?? "", primaryTimezone: firm.primaryTimezone, clientTimezone: firm.clientTimezone });
  const nameError = form.name.trim() ? null : "Enter the firm's name.";
  const close = () => {
    update.reset();
    setForm({ name: firm.name, contactPhone: firm.contactPhone ?? "", primaryTimezone: firm.primaryTimezone, clientTimezone: firm.clientTimezone });
    onClose();
  };
  return (
    <AdminDialog
      open={open}
      onClose={close}
      title={`Edit ${firm.name}`}
      confirmLabel="Save changes"
      pendingLabel="Saving…"
      isPending={update.isPending}
      canConfirm={!nameError}
      error={errorMessage(update.error)}
      onConfirm={() => update.mutate({ ...form, contactPhone: form.contactPhone.trim() || null }, { onSuccess: onClose })}
    >
      <Field id="edit-name" label="Firm name" error={nameError}>
        <Input {...fieldAria("edit-name", nameError)} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </Field>
      <Field id="edit-phone" label="Contact phone (optional)">
        <Input id="edit-phone" type="tel" value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} />
      </Field>
      <Field id="edit-tz" label="Primary timezone">
        <select id="edit-tz" value={form.primaryTimezone} onChange={(event) => setForm({ ...form, primaryTimezone: event.target.value })} className="bq-input w-full">
          {timezoneOptions(firm.primaryTimezone).map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
        </select>
      </Field>
      <Field id="edit-client-tz" label="Client timezone">
        <select id="edit-client-tz" value={form.clientTimezone} onChange={(event) => setForm({ ...form, clientTimezone: event.target.value })} className="bq-input w-full">
          {timezoneOptions(firm.clientTimezone).map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
        </select>
      </Field>
    </AdminDialog>
  );
}

/** Change slug: live checks, a warning that old links break (no redirect, A7), and the new slug typed again. */
export function ChangeSlugDialog({ firm, open, onClose }: DialogProps) {
  const change = useChangeSlug(firm.id);
  const firms = usePlatformFirms();
  const [slug, setSlug] = useState(firm.slug);
  const [confirmation, setConfirmation] = useState("");
  const taken = (firms.data ?? []).filter((item) => item.id !== firm.id).map((item) => item.slug);
  const isUsable = slug !== firm.slug && slugProblem(slug, taken) === null;
  const isConfirmed = isUsable && confirmation === slug;
  const close = () => {
    change.reset();
    setSlug(firm.slug);
    setConfirmation("");
    onClose();
  };
  return (
    <AdminDialog
      open={open}
      onClose={close}
      title="Change slug"
      tone="danger"
      description={
        <p>
          <strong>Every link to this firm&apos;s workspace will stop working. There is no redirect.</strong> Its users sign in as before and land
          on the new URL.
        </p>
      }
      confirmLabel="Change slug"
      pendingLabel="Changing…"
      isPending={change.isPending}
      canConfirm={isConfirmed}
      error={errorMessage(change.error)}
      onConfirm={() => change.mutate(slug, { onSuccess: close })}
    >
      <SlugField id="change-slug" value={slug} onChange={setSlug} taken={taken} showError={false} />
      <Field id="change-slug-confirm" label="Type the new slug to confirm" hint={isUsable ? <>Type <span className="text-mono-sm">{slug}</span></> : "Enter a new, valid slug first."}>
        <Input
          {...fieldAria("change-slug-confirm", null, true)}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          disabled={!isUsable}
        />
      </Field>
    </AdminDialog>
  );
}

const MIN_REASON = 10;

/** Suspend (ACTIVE firms only, 07 Q29): a required reason; nothing is deleted. */
export function SuspendFirmDialog({ firm, open, onClose }: DialogProps) {
  const suspend = useSuspendFirm(firm.id);
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const close = () => {
    suspend.reset();
    setReason("");
    onClose();
  };
  return (
    <AdminDialog
      open={open}
      onClose={close}
      title={`Suspend ${firm.name}?`}
      tone="danger"
      description={
        <>
          <p>Its users can still sign in, but they see &ldquo;Workspace suspended&rdquo; instead of their work. Nothing is deleted.</p>
          <p>The reason goes in the firm&apos;s activity log.</p>
        </>
      }
      confirmLabel="Suspend firm"
      pendingLabel="Suspending…"
      isPending={suspend.isPending}
      canConfirm={length >= MIN_REASON}
      error={errorMessage(suspend.error)}
      onConfirm={() => suspend.mutate(reason.trim(), { onSuccess: close })}
    >
      <Field id="suspend-reason" label="Reason" hint={<span className="tabular">{length} / {MIN_REASON} characters minimum</span>}>
        <textarea {...fieldAria("suspend-reason", null, true)} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="bq-input h-auto w-full py-2" />
      </Field>
    </AdminDialog>
  );
}

/** Reactivate (SUSPENDED only); not blocked by being over a limit (docs/02 implication 5). */
export function ReactivateFirmDialog({ firm, open, onClose }: DialogProps) {
  const reactivate = useReactivateFirm(firm.id);
  const close = () => {
    reactivate.reset();
    onClose();
  };
  return (
    <AdminDialog
      open={open}
      onClose={close}
      title={`Reactivate ${firm.name}?`}
      description={<p>Its users get their workspace back. If the firm is over a limit, its existing users keep working; new additions stay blocked.</p>}
      confirmLabel="Reactivate firm"
      pendingLabel="Reactivating…"
      isPending={reactivate.isPending}
      error={errorMessage(reactivate.error)}
      onConfirm={() => reactivate.mutate(undefined, { onSuccess: close })}
    />
  );
}
