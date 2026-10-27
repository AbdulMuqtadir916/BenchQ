/**
 * Feature flags read from the environment, in one place. Each is temporary: it names the change that removes it.
 *
 * NEXT_PUBLIC_CANDIDATE_WIZARD=true renders the new five-step "New candidate" flow on /candidates/new instead of the
 * single form (docs/candidate-onboarding/04-wizard-steps.md). Onboarding module 05 removes the flag and the old form.
 */
export function isCandidateWizardEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CANDIDATE_WIZARD === "true";
}
