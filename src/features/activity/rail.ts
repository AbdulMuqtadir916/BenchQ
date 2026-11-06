import type { LedgerPerson } from "@/lib/schemas/analytics";
import type { ActivityParams } from "./use-activity-params";

/** Which part of the firm the reader starts from: the three levels of the people list. */
export type ViewerScope = "firm" | "team" | "own";
export interface Viewer {
  userId: string;
  scope: ViewerScope;
}

/** Who the log is narrowed to, once the URL is checked against who this reader may see. */
export interface Selection {
  team?: string;
  person?: string;
}

export interface ManagerRow {
  person: LedgerPerson;
  bdes: number;
  actions: number;
}

export type Rail =
  | { level: "own"; me: LedgerPerson | null }
  | { level: "firm"; managers: ManagerRow[]; you: LedgerPerson | null; unassigned: LedgerPerson[]; former: LedgerPerson[]; total: number }
  | { level: "team"; manager: LedgerPerson; bdes: LedgerPerson[]; former: LedgerPerson[]; actions: number; isOwnTeam: boolean };

// These sort rows into the list's groups; they decide nothing about access, which the backend has already applied.
const isManagerRow = (person: LedgerPerson) => person.role === "MANAGER";
const isBdeRow = (person: LedgerPerson) => person.role === "BDE";

const firstName = (name: string) => name.split(" ")[0];
const byActions = (a: ManagerRow, b: ManagerRow) => b.actions - a.actions || a.person.name.localeCompare(b.person.name);

const currentBdesOf = (people: LedgerPerson[], managerId: string) =>
  people.filter((person) => isBdeRow(person) && !person.isFormer && person.managerId === managerId);

/** A URL naming someone the reader can't see falls back to their own root (the backend refuses the rows anyway). */
export function resolveSelection(people: LedgerPerson[], viewer: Viewer, params: Pick<ActivityParams, "team" | "person">): Selection {
  if (viewer.scope === "own") return params.person === viewer.userId ? { person: viewer.userId } : {};
  const person = people.find((candidate) => candidate.userId === params.person);
  if (person) return { person: person.userId };
  if (viewer.scope === "team") return {};
  const manager = people.find((candidate) => candidate.userId === params.team && isManagerRow(candidate));
  return manager ? { team: manager.userId } : {};
}

function openManager(people: LedgerPerson[], viewer: Viewer, selection: Selection): LedgerPerson | undefined {
  const find = (id: string | null | undefined) => people.find((person) => person.userId === id);
  if (viewer.scope === "team") return find(viewer.userId);
  if (selection.team) return find(selection.team);
  const person = find(selection.person);
  if (!person || person.userId === viewer.userId) return undefined;
  return isManagerRow(person) ? person : find(person.managerId);
}

export function buildRail(people: LedgerPerson[], viewer: Viewer, selection: Selection, total: number): Rail {
  if (viewer.scope === "own") return { level: "own", me: people.find((person) => person.userId === viewer.userId) ?? null };
  const manager = openManager(people, viewer, selection);
  if (manager) {
    const bdes = currentBdesOf(people, manager.userId);
    const former = people.filter((person) => person.isFormer && isBdeRow(person) && (viewer.scope === "team" || person.managerId === manager.userId));
    const actions = [manager, ...bdes, ...former].reduce((sum, person) => sum + person.actions, 0);
    return { level: "team", manager, bdes, former, actions, isOwnTeam: manager.userId === viewer.userId };
  }
  const managers = people.filter((person) => isManagerRow(person) && !person.isFormer)
    .map((person) => {
      const bdes = currentBdesOf(people, person.userId);
      return { person, bdes: bdes.length, actions: person.actions + bdes.reduce((sum, bde) => sum + bde.actions, 0) };
    })
    .sort(byActions);
  return {
    level: "firm",
    managers,
    you: people.find((person) => person.userId === viewer.userId) ?? null,
    unassigned: people.filter((person) => isBdeRow(person) && !person.isFormer && person.managerId === null),
    former: people.filter((person) => person.isFormer),
    total,
  };
}

/** One step up, never above the reader's root; null at the root. */
export function backStep(rail: Rail, viewer: Viewer, selection: Selection): { label: string; to: Selection } | null {
  if (viewer.scope === "own") return null;
  if (viewer.scope === "team") return selection.person ? { label: "Whole team", to: {} } : null;
  if (rail.level === "team" && selection.person && selection.person !== rail.manager.userId) {
    return { label: `${rail.manager.name}'s team`, to: { team: rail.manager.userId } };
  }
  return selection.team || selection.person ? { label: "All managers", to: {} } : null;
}

export function viewTitle(rail: Rail, viewer: Viewer, selection: Selection, people: LedgerPerson[]): string {
  if (viewer.scope === "own" || selection.person === viewer.userId) return "Your actions";
  const person = people.find((candidate) => candidate.userId === selection.person);
  if (person) return `${person.name}'s activity`;
  if (rail.level === "team") return rail.isOwnTeam ? "Your team's activity" : `${rail.manager.name}'s team`;
  return "Whole firm activity";
}

export function viewSubtitle(rail: Rail, viewer: Viewer, selection: Selection, people: LedgerPerson[]): string {
  const immutable = "Entries can't be edited or deleted.";
  if (viewer.scope === "own" || selection.person === viewer.userId) return `What you did, by hand or through an AI agent you started. ${immutable}`;
  const person = people.find((candidate) => candidate.userId === selection.person);
  if (person) return `Every action ${person.name} took, by hand or through an AI agent they started. ${immutable}`;
  if (rail.level === "team") return `Every action by this team, as it was when each one happened. ${immutable}`;
  return `Every action across the firm, by people, AI agents and the system. Choose a manager to see their team. ${immutable}`;
}

/** What a manager's row says under their name: never "own", which reads as the owner's. */
export function managerRowLabel(manager: LedgerPerson, viewer: Viewer): string {
  return manager.userId === viewer.userId ? "Your actions" : `${firstName(manager.name)}'s actions`;
}

export interface ActorOption {
  value: string;
  label: string;
}

/** The actor list: the people the reader may see, then the AI agent, and System where the reader's rows include it. */
export function actorOptions(people: LedgerPerson[], viewer: Viewer, actorTypes: readonly string[]): ActorOption[] {
  const named = people
    .filter((person) => viewer.scope === "own" || isManagerRow(person) || isBdeRow(person))
    .map((person) => ({ value: person.userId, label: person.isFormer ? `${person.name} (former)` : person.name }));
  return [
    { value: "ALL", label: "All actors" },
    ...named,
    { value: "AGENT", label: "AI agent" },
    ...(actorTypes.includes("SYSTEM") ? [{ value: "SYSTEM", label: "System" }] : []),
  ];
}
