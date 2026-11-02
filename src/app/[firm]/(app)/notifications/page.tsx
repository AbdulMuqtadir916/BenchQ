import { NotificationsInbox } from "@/components/app/notifications-inbox";
import { PageHeader } from "@/components/app/page-header";

export default function FirmNotificationsPage() {
  return (
    <div className="bq-page">
      <PageHeader title="Notifications" subtitle="Requests and updates for your account." />
      <NotificationsInbox />
    </div>
  );
}
