import { RouteGuard } from "@/components/routes/route-guard";

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard>{children}</RouteGuard>;
}
