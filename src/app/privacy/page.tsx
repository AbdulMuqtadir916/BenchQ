import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { hrefFor } from "@/lib/routes/registry";

/**
 * /privacy (docs/07 §2.1): BenchQ Apply's privacy policy, open to everyone, signed in or not, because the Chrome Web
 * Store listing links to it (docs/extension-store.md §4). It must say what the store's data-use answers say (§3): when
 * the extension starts reading, sending or keeping something new, change both, and the date below.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-start justify-center p-4 sm:py-10">
      <Card className="w-full max-w-2xl p-6 shadow-lg sm:p-8">
        <header className="mb-8">
          <p className="text-display text-[var(--color-text)]">BenchQ</p>
          <h1 className="mt-5 text-h1 text-[var(--color-text)]">BenchQ Apply privacy policy</h1>
          <p className="mt-2 text-caption text-[var(--color-text-3)]">
            Last updated <time dateTime="2026-11-21">21 November 2026</time>
          </p>
        </header>

        <div className="space-y-6 text-body text-[var(--color-text-2)]">
          <p>
            BenchQ Apply is a browser extension for people who use BenchQ. It acts only on the tab you connect to a
            BenchQ job, and, after you allow it, on sites you approve.
          </p>

          <Section title="What it reads">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                The form fields on the connected job application page, so it can fill them, and so BenchQ can record
                what was filled when you mark the application applied.
              </li>
              <li>The address of the connected tab, to check it is the job you meant.</li>
              <li>
                When you add a job you found to BenchQ, the job posting on that page: its title, company, location,
                description, pay and address.
              </li>
            </ul>
          </Section>

          <Section title="What it sends, and where">
            <p>
              The résumé answers and the résumé file it uses to fill a form come from your BenchQ account, and the
              recorded form goes back to your BenchQ account, all over HTTPS to app.benchq.io. So does a job you add,
              and an answer you type and choose to keep for next time. Your sign-in is the BenchQ session cookie,
              which the browser keeps and the extension never reads.
            </p>
            <p>
              When you press Autofill, pick a different résumé for the job (which fills the form again from that
              résumé), pick a file of your own to attach instead, or use a field&apos;s Replace, Replace all or Use
              button (which writes a saved answer into that field), the candidate&apos;s answers and the attached file
              are written into the employer&apos;s application page in that tab. The page can read them, and may save
              or upload them before you submit, as with anything typed into a form. That can include answers a
              candidate has saved to self-identification questions (gender, race or ethnicity, veteran status,
              disability) and to pay questions. A file you pick yourself goes only into that page, never to BenchQ.
            </p>
            <p>
              When you mark the application applied, BenchQ records the form as filled (for a file, its name).
              Answers to questions BenchQ recognises as self-identification are left out of that record, and so is
              any Social Security or card number. Everything else is kept, including salary and rate answers,
              accommodation questions, and any self-identification question worded in a way BenchQ does not
              recognise.
            </p>
            <p>Nothing is sent anywhere else, sold, or used for advertising.</p>
          </Section>

          <Section title="What it keeps">
            <ul className="list-disc space-y-1 pl-5">
              <li>For the current browser session: which tab is connected to which job, erased when the browser closes.</li>
              <li>
                In the extension&apos;s own storage on this device, until you uninstall it: your light or dark theme,
                the last candidate you picked (an ID, not their details), and when it last reloaded itself after an
                update.
              </li>
              <li>A file you pick yourself is held only in the open panel&apos;s memory, and is gone when the panel closes.</li>
            </ul>
            <p>Nothing else is stored, and none of it leaves the device.</p>
          </Section>

          <Section title="Your control">
            <p>
              Filling starts only when you press Autofill, pick a résumé or a file of your own for the job, or use a
              field&apos;s Replace, Replace all or Use button, and you submit every form yourself. You can remove BenchQ
              Apply&apos;s access to any site in chrome://extensions, and uninstall it at any time.
            </p>
          </Section>

          <Section title="Questions">
            <p>For BenchQ account data, contact your firm&apos;s owner in BenchQ.</p>
          </Section>
        </div>

        <footer className="mt-8 border-t border-[var(--color-border)] pt-6 text-center">
          <Link href={hrefFor("sign-in")} className="text-caption text-[var(--color-primary)]">
            Sign in to BenchQ
          </Link>
        </footer>
      </Card>
    </main>
  );
}

/** One part of the policy, under its heading. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-h3 text-[var(--color-text)]">{title}</h2>
      {children}
    </section>
  );
}
