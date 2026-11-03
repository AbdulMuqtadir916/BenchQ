import { NotificationsShell } from "@/components/app/notifications/notifications-shell";

export default function FirmNotificationsLayout({ children }: { children: React.ReactNode }) {
  return <NotificationsShell subtitle="Requests and updates for your account.">{children}</NotificationsShell>;
}
