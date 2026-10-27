"use client";

import { Link2, Mail, MapPin, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SKILL_SUGGESTIONS } from "@/lib/constants/candidate-intake";
import { fieldAria, StepSection, WizardField } from "./field";
import { PrefixedInput, ReviewStrip } from "./parts";
import { TagInput } from "./tag-input";
import type { Errors, WizardSkill } from "./model";
import type { Wizard } from "./use-wizard";

const FIELDS = ["fullName", "primaryRole", "yearsExperience", "email", "phone", "linkedinUrl", "city", "state", "skills", "summary"] as const;

/** Step 2 (04-wizard-steps.md §3): identity, contact, profile. Name, "Marketed as" and email are required (07 Q48). */
export function StepBasic({ wizard, errors }: { wizard: Wizard; errors: Errors }) {
  const { values, drafted, set } = wizard;
  const drafts = FIELDS.filter((field) => drafted.has(field));
  const text = (field: "fullName" | "primaryRole" | "yearsExperience" | "email" | "phone" | "linkedinUrl" | "city" | "state" | "summary") => ({
    value: values[field],
    onChange: (event: { target: { value: string } }) => set(field, event.target.value),
  });

  function setSkills(names: string[]) {
    const kept = values.skills.filter((skill) => names.includes(skill.name));
    const added = names.filter((name) => !kept.some((skill) => skill.name === name)).map((name): WizardSkill => ({ name, family: null, source: "MANUAL" }));
    set("skills", [...kept, ...added]);
  }

  return (
    <div className="space-y-8">
      <ReviewStrip count={drafts.length} onReviewed={() => wizard.markReviewed(drafts)} />

      <StepSection title="Identity">
        <WizardField id="cw-name" label="Full name" required error={errors.fullName} isDrafted={drafted.has("fullName")}>
          <Input {...fieldAria("cw-name", errors.fullName)} {...text("fullName")} placeholder="e.g. Ravi Teja Kommineni" autoComplete="off" />
        </WizardField>
        <div className="grid gap-4 sm:grid-cols-2">
          <WizardField id="cw-role" label="Marketed as" required hint="The headline title BDEs submit under." error={errors.primaryRole} isDrafted={drafted.has("primaryRole")}>
            <Input {...fieldAria("cw-role", errors.primaryRole, true)} {...text("primaryRole")} placeholder="e.g. Senior Java Full Stack Developer" />
          </WizardField>
          <WizardField id="cw-years" label="Years of experience" error={errors.yearsExperience} isDrafted={drafted.has("yearsExperience")}>
            <Input {...fieldAria("cw-years", errors.yearsExperience)} {...text("yearsExperience")} inputMode="numeric" placeholder="e.g. 9" />
          </WizardField>
        </div>
      </StepSection>

      <StepSection title="Contact" description="Shown to vendors only when a submission goes out.">
        <div className="grid gap-4 sm:grid-cols-2">
          <WizardField id="cw-email" label="Email" required error={errors.email} isDrafted={drafted.has("email")}>
            <PrefixedInput icon={Mail}><input {...fieldAria("cw-email", errors.email)} {...text("email")} type="email" placeholder="name@example.com" className="w-full bg-transparent outline-none" /></PrefixedInput>
          </WizardField>
          <WizardField id="cw-phone" label="Phone" isDrafted={drafted.has("phone")}>
            <PrefixedInput icon={Phone}><input {...fieldAria("cw-phone")} {...text("phone")} type="tel" placeholder="(469) 555-0182" className="w-full bg-transparent outline-none" /></PrefixedInput>
          </WizardField>
        </div>
        <WizardField id="cw-linkedin" label="LinkedIn" error={errors.linkedinUrl} isDrafted={drafted.has("linkedinUrl")}>
          <PrefixedInput icon={Link2}><input {...fieldAria("cw-linkedin", errors.linkedinUrl)} {...text("linkedinUrl")} type="url" placeholder="https://www.linkedin.com/in/…" className="w-full bg-transparent outline-none" /></PrefixedInput>
        </WizardField>
        <div className="grid gap-4 sm:grid-cols-2">
          <WizardField id="cw-city" label="City" isDrafted={drafted.has("city")}>
            <PrefixedInput icon={MapPin}><input {...fieldAria("cw-city")} {...text("city")} placeholder="e.g. Irving" className="w-full bg-transparent outline-none" /></PrefixedInput>
          </WizardField>
          <WizardField id="cw-state" label="State" isDrafted={drafted.has("state")}>
            <Input {...fieldAria("cw-state")} {...text("state")} placeholder="e.g. TX" />
          </WizardField>
        </div>
      </StepSection>

      <StepSection title="Profile" description="Feeds matching and the first draft of every tailored resume.">
        <WizardField id="cw-skills" label="Skills" isDrafted={drafted.has("skills")}>
          <TagInput id="cw-skills" label="skills" values={values.skills.map((skill) => skill.name)} onChange={setSkills} suggestions={SKILL_SUGGESTIONS} placeholder="Java, Spring Boot, AWS…" />
        </WizardField>
        <WizardField id="cw-summary" label="Summary" hint="Two or three lines a BDE can paste into an intro email." isDrafted={drafted.has("summary")}>
          <textarea {...fieldAria("cw-summary", undefined, true)} {...text("summary")} rows={3} className="bq-input h-auto w-full py-2" />
        </WizardField>
      </StepSection>
    </div>
  );
}
