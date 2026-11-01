import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCandidateInbox } from "@/lib/hooks/use-inbox";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { FirmSchema } from "@/lib/schemas/session";
import { InboxTab } from "@/components/app/candidate/inbox/inbox-tab";
import type { CandidateWorkspace } from "@/components/app/candidate/use-candidate-workspace";
import type { CandidateActions } from "@/components/app/candidate/candidate-actions";
import "@/app/globals.css";
const client = new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
const firm = FirmSchema.parse({id:"qa-firm",name:"Synthetic Gmail QA",slug:"synthetic-qa",logoUrl:null,status:"ACTIVE",planId:"qa-plan",seatLimit:10,candidateLimit:10,contactPhone:null,createdAt:"2026-11-02T00:00:00Z"});
function Harness() {
  const inboxQuery = useCandidateInbox("qa-candidate");
  const [selected,select] = useState<string|null>(null);
  const canAct = new URLSearchParams(location.search).get("state") !== "readonly";
  const ws = {candidate:{id:"qa-candidate",fullName:"Synthetic Candidate"},messages:inboxQuery.data?.messages??[],applications:[],suggestions:[],inbox:inboxQuery.data??null,inboxQuery} as unknown as CandidateWorkspace;
  return <main className="bq-page min-h-screen bg-[var(--color-surface)] text-[var(--color-text)]"><h1 className="mb-4 text-h2">Candidate Gmail acceptance</h1><InboxTab ws={ws} actions={{openApplication:()=>{},applySuggestion:()=>{}} as unknown as CandidateActions} canAct={canAct} selectedId={selected} onSelect={select}/></main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><FirmProvider firm={firm}><Harness/></FirmProvider></QueryClientProvider>);
