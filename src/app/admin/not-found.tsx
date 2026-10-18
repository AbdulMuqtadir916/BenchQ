import { NotFoundState } from "@/components/app/not-found-state";

/** notFound() under /admin: inside the admin layout, so a platform admin keeps the shell around it. */
export default function AdminNotFound() {
  return <NotFoundState />;
}
