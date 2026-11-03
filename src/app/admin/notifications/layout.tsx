import { NotificationsShell } from "@/components/app/notifications/notifications-shell";

export default function AdminNotificationsLayout({ children }: { children: React.ReactNode }) {
  return <NotificationsShell subtitle="Review platform approval requests.">{children}</NotificationsShell>;
}
