import { RouteGuard } from "@/components/routes/route-guard";

export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard>{children}</RouteGuard>;
}
