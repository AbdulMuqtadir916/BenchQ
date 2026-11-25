import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NotificationsMenu } from "./notifications-menu";

vi.mock("@/lib/routes/use-href", () => ({ useHref: () => () => "/" }));
vi.mock("@/lib/hooks/use-notifications", () => ({
  useNotifications: () => ({ data: [] }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
  isPendingRequest: () => true,
}));

it("shows an empty bell for a firm with no notifications", () => {
  const bell = renderToStaticMarkup(createElement(NotificationsMenu, { variant: "firm" }));
  expect(bell).toContain('aria-label="Notifications"');
  expect(bell).not.toContain("unread");
});
