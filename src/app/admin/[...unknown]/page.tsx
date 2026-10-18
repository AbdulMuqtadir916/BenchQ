import { notFound } from "next/navigation";

/**
 * Any /admin URL with no page. Not a route (the registry skips catch-alls): it exists so the URL renders
 * inside the admin layout, the platform guard first and then the admin shell, instead of the bare root
 * not-found that Next serves for unmatched URLs.
 */
export default function AdminUnknownPage() {
  notFound();
}
