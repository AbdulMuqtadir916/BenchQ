import { z } from "zod";
import { Landing } from "@/components/routes/landing";

export default async function RootPage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const query = await searchParams;
  return <Landing mailboxFailed={z.literal("failed").safeParse(query.mailbox).success} />;
}
