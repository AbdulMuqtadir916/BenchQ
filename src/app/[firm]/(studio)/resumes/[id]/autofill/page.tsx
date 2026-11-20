import { OpenResume } from "@/components/app/resume-studio/open-resume";

/**
 * The Autofill answers tab of one résumé version (docs/04, 07 Q6, Q13): the studio's third tab, with its access. It
 * keeps the studio's mode, so Builder and Viewer come back as they were.
 */
export default async function ResumeAutofillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpenResume id={id} initialMode={null} isAutofill />;
}
