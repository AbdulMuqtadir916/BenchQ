import { redirect } from "next/navigation";
import { hrefFor } from "@/lib/routes/registry";

export default function RootPage() {
  redirect(hrefFor("dashboard"));
}
