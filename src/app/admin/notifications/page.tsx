import { NotificationsInbox } from "@/components/app/notifications-inbox";
import { PageHeader } from "@/components/app/page-header";

export default function AdminNotificationsPage() {
  return <div className="bq-page"><PageHeader title="Notifications" subtitle="Review platform approval requests." /><NotificationsInbox /></div>;
}
