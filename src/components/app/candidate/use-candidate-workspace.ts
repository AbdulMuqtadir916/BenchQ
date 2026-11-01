"use client";

import { useMemo, useState } from "react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { InboxMessage } from "@/lib/schemas/inbox";
import { useCandidate } from "@/lib/hooks/use-candidates";
import { useCandidateApplications, useFollowups } from "@/lib/hooks/use-applications";
import { useRecord } from "@/lib/hooks/use-records";
import { useResumes } from "@/lib/hooks/use-resumes";
import { useCandidateJobs } from "@/lib/hooks/use-jobs";
import { useTeam } from "@/lib/hooks/use-team";
import { useCandidateInbox } from "@/lib/hooks/use-inbox";
import { useCandidateDocuments } from "@/lib/hooks/use-documents";
import { deriveCandidateStats, deriveExportGate } from "@/lib/derive";
import { isClosed } from "@/components/app/applications/status-meta";
import { latestSignalByApplication, needsBdeReview, pendingSuggestion } from "@/components/app/inbox/signal-meta";

export interface Suggestion {
  message: InboxMessage;
  applicationId: string;
  to: ApplicationStatus;
  reviewId?: string;
  reviewRevision?: number;
}

/**
 * Everything the candidate page's tabs share, loaded once and derived in one
 * place — counts, suggestions and upcoming events are computed, never stored.
 */
export function useCandidateWorkspace(candidateId: string, messageId?: string | null) {
  const [now] = useState(() => Date.now());
  const candidateQuery = useCandidate(candidateId);
  const applicationsQuery = useCandidateApplications(candidateId);
  const recordQuery = useRecord(candidateId);
  const resumesQuery = useResumes(candidateId);
  const candidateJobsQuery = useCandidateJobs(candidateId);
  const jobsQuery = {
    data: candidateJobsQuery.data?.jobs,
    error: candidateJobsQuery.error,
    isLoading: candidateJobsQuery.isLoading,
    refetch: candidateJobsQuery.refetch,
  };
  const favoriteJobIds = candidateJobsQuery.data?.favoriteJobIds ?? [];
  const inboxQuery = useCandidateInbox(candidateId, messageId);
  const documentsQuery = useCandidateDocuments(candidateId);
  const followupsQuery = useFollowups();
  const teamQuery = useTeam();

  const candidate = candidateQuery.data;
  const applications = useMemo(() => applicationsQuery.data ?? [], [applicationsQuery.data]);
  const messages = useMemo(() => {
    const pending = new Set(applications.flatMap((app) => app.pendingReviews.map((review) => review.messageId)));
    return (inboxQuery.data?.messages ?? []).filter((message) => message.id === messageId || message.signal !== "OTHER"
      || needsBdeReview(message, pending.has(message.id)));
  }, [inboxQuery.data, applications, messageId]);

  const derived = useMemo(() => {
    const statusById = new Map(applications.map((a) => [a.id, a.status]));
    const byApp = new Map<string, Suggestion>();
    for (const message of messages) {
      if (!message.applicationId) continue;
      const application = applications.find((a) => a.id === message.applicationId);
      const pendingReview = application?.pendingReviews.find((review) => review.messageId === message.id);
      const to = pendingReview ? pendingSuggestion(message, statusById.get(message.applicationId)) : null;
      const existing = byApp.get(message.applicationId);
      if (to && (!existing || message.receivedAt > existing.message.receivedAt)) byApp.set(message.applicationId, {
        message, applicationId: message.applicationId, to,
        reviewId: pendingReview?.id, reviewRevision: pendingReview?.revision,
      });
    }
    const appIds = new Set(applications.map((a) => a.id));
    const followups = (followupsQuery.data ?? [])
      .filter((f) => appIds.has(f.applicationId) && (f.state === "PENDING" || f.state === "SNOOZED"))
      .sort((a, b) => ((a.snoozedUntil ?? a.dueAt) < (b.snoozedUntil ?? b.dueAt) ? -1 : 1));
    const upcoming = messages
      .filter((m) => m.scheduledFor && new Date(m.scheduledFor).getTime() > now && (m.signal === "INTERVIEW_SCHEDULED" || m.signal === "CALL_REQUEST"))
      .filter((m) => !m.applicationId || !isClosed(statusById.get(m.applicationId) ?? "APPLIED"))
      .sort((a, b) => (a.scheduledFor! < b.scheduledFor! ? -1 : 1));
    return {
      statusById,
      suggestions: [...byApp.values()],
      followups,
      upcoming,
      signals: latestSignalByApplication(messages),
      unread: messages.filter((m) => !m.isRead && m.signal !== "CONFIRMATION").length,
    };
  }, [applications, messages, followupsQuery.data, now]);

  const stats = useMemo(() => (candidate ? deriveCandidateStats(candidate, applications) : null), [candidate, applications]);

  /** Visa, ID and certificate files that have expired or expire within 60 days. */
  const expiringDocuments = useMemo(
    () => (documentsQuery.data ?? []).filter((d) => d.expiresAt && new Date(d.expiresAt).getTime() < now + 60 * 86_400_000).sort((a, b) => (a.expiresAt! < b.expiresAt! ? -1 : 1)),
    [documentsQuery.data, now],
  );

  /** The master resume is the verified source every tailored copy reuses. */
  const master = useMemo(() => {
    const resume = (resumesQuery.data ?? []).find((r) => r.isMaster);
    const version = resume?.versions.find((v) => v.id === resume.latestVersionId) ?? resume?.versions[0];
    if (!resume || !version) return null;
    const claims = version.claims.filter((c) => c.state !== "CONTRADICTED");
    return { resume, gate: deriveExportGate(version), total: claims.length, verified: claims.filter((c) => c.state === "VERIFIED").length };
  }, [resumesQuery.data]);
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
    resumesQuery,
    jobsQuery,
    candidateJobsQuery,
    favoriteJobIds,
    inboxQuery,
    inbox: inboxQuery.data ?? null,
    documentsQuery,
    expiringDocuments,
    master,
    messages,
    stats,
    ownerName,
    teamName,
    ...derived,
  };
}

export type CandidateWorkspace = ReturnType<typeof useCandidateWorkspace>;
