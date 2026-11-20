import { BriefcaseBusiness, CircleHelp, ClipboardCheck, GraduationCap, MapPin, MessageSquareText, ShieldCheck, SlidersHorizontal, TriangleAlert, UserRound, UserRoundCheck, Wrench, type LucideIcon } from "lucide-react";
import type { AutofillTopicId } from "@/lib/derive/autofill-view";

/** One icon per topic of the Autofill tab (docs/05 icon set: lucide). */
export const TOPIC_ICONS: Record<AutofillTopicId, LucideIcon> = {
  review: TriangleAlert,
  contact: UserRound,
  location: MapPin,
  authorization: ShieldCheck,
  experience: BriefcaseBusiness,
  education: GraduationCap,
  skills: Wrench,
  preferences: SlidersHorizontal,
  screening: ClipboardCheck,
  "self-id": UserRoundCheck,
  other: CircleHelp,
  custom: MessageSquareText,
};
