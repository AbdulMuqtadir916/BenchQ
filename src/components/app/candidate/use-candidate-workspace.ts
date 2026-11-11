"use client";

import { useMemo, useState } from "react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { useCandidate } from "@/lib/hooks/use-candidates";
import { useApplications } from "@/lib/hooks/use-applications";
import { useRecord } from "@/lib/hooks/use-records";
import { useResumeShelf } from "@/lib/hooks/use-resumes";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useTeam } from "@/lib/hooks/use-team";
import { useCandidateInbox } from "@/lib/hooks/use-inbox";
import { useCandidateDocuments } from "@/lib/hooks/use-documents";
import { deriveCandidateStats } from "@/lib/derive";
import { isClosed } from "@/components/app/applications/status-meta";
import { latestSignalByApplication, pendingSuggestion } from "@/components/app/inbox/signal-meta";

export interface Suggestion {
  message: InboxMessage;
  applicationId: string;
  to: ApplicationStatus;
}

/**
 * Everything the candidate page's tabs share, loaded once and derived in one
 * place — counts, suggestions and upcoming events are computed, never stored.
 */
export function useCandidateWorkspace(candidateId: string) {
  const [now] = useState(() => Date.now());
  const candidateQuery = useCandidate(candidateId);
  const applicationsQuery = useApplications(candidateId);
  const recordQuery = useRecord(candidateId);
  const shelfQuery = useResumeShelf(candidateId);
  const jobsQuery = useJobs({ limit: 400, candidateId }); // the candidate's own jobs (docs/02 §6.z)
  const inboxQuery = useCandidateInbox(candidateId);
  const documentsQuery = useCandidateDocuments(candidateId);
  const teamQuery = useTeam();

  const candidate = candidateQuery.data;
  const applications = useMemo(() => applicationsQuery.data ?? [], [applicationsQuery.data]);
  const messages = useMemo(() => inboxQuery.data?.messages ?? [], [inboxQuery.data]);

  const derived = useMemo(() => {
    const statusById = new Map(applications.map((a) => [a.id, a.status]));
    const byApp = new Map<string, Suggestion>();
    for (const message of messages) {
      if (!message.applicationId) continue;
      const to = pendingSuggestion(message, statusById.get(message.applicationId));
      const existing = byApp.get(message.applicationId);
      if (to && (!existing || message.receivedAt > existing.message.receivedAt)) byApp.set(message.applicationId, { message, applicationId: message.applicationId, to });
    }
    const upcoming = messages
      .filter((m) => m.scheduledFor && new Date(m.scheduledFor).getTime() > now && (m.signal === "INTERVIEW_SCHEDULED" || m.signal === "CALL_REQUEST"))
      .filter((m) => !m.applicationId || !isClosed(statusById.get(m.applicationId) ?? "APPLIED"))
      .sort((a, b) => (a.scheduledFor! < b.scheduledFor! ? -1 : 1));
    return {
      statusById,
      suggestions: [...byApp.values()],
      upcoming,
      signals: latestSignalByApplication(messages),
      unread: messages.filter((m) => !m.isRead && m.signal !== "CONFIRMATION").length,
    };
  }, [applications, messages, now]);

  const stats = useMemo(() => (candidate ? deriveCandidateStats(candidate, applications) : null), [candidate, applications]);

  /** Visa, ID and certificate files that have expired or expire within 60 days. */
  const expiringDocuments = useMemo(
    () => (documentsQuery.data ?? []).filter((d) => d.expiresAt && new Date(d.expiresAt).getTime() < now + 60 * 86_400_000).sort((a, b) => (a.expiresAt! < b.expiresAt! ? -1 : 1)),
    [documentsQuery.data, now],
  );

  const resumes = useMemo(() => shelfQuery.data?.resumes ?? [], [shelfQuery.data]);
  /** The active base (the one the workflow uses), its newest version, and how many copies were tailored from it. */
  const base = useMemo(() => {
    const active = shelfQuery.data?.bases.find((b) => b.isActive);
    const resume = active ? resumes.find((r) => r.isMaster && r.baseResumeId === active.id) : undefined;
    const version = resume?.versions.find((v) => v.id === resume.latestVersionId) ?? resume?.versions[0];
    if (!resume || !version) return null;
    return { resume, version, tailoredCount: resumes.filter((r) => !r.isMaster && r.baseResumeId === active!.id).length };
  }, [shelfQuery.data, resumes]);
  const teamName = useMemo(() => {
    const names = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    return (id: string | null) => (id ? (names.get(id) ?? null) : null);
  }, [teamQuery.data]);
  const ownerName = teamName(candidate?.bdeId ?? null);

  return {
    now,
    candidateQuery,
    candidate,
    applications,
    applicationsQuery,
    recordQuery,
    shelfQuery,
    resumes,
    jobsQuery,
    inboxQuery,
    inbox: inboxQuery.data ?? null,
    documentsQuery,
    expiringDocuments,
    base,
    messages,
    stats,
    ownerName,
    teamName,
    ...derived,
  };
}

export type CandidateWorkspace = ReturnType<typeof useCandidateWorkspace>;
