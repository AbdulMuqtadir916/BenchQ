import { RouteGuard } from "@/components/routes/route-guard";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard>{children}</RouteGuard>;
}
