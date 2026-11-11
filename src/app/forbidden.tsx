import { ForbiddenScreen } from "@/components/routes/forbidden-screen";
import { ForbiddenSupportBanner } from "@/components/app/support/support-banner";
import { readSession } from "@/lib/server/principal";

/** `forbidden()` from a layout (src/lib/server/principal.ts): a real 403 with the Forbidden screen. */
export default async function Forbidden() {
  const session = await readSession();
  const support = session && "platformUser" in session ? session : null;
  return (
    <>
      <ForbiddenScreen />
      <ForbiddenSupportBanner banner={support?.firm && support.principal.support?.firmId === support.firm.id
        ? { view: support.principal.support, firmName: support.firm.name, adminName: support.platformUser.name }
        : null} />
    </>
  );
}
