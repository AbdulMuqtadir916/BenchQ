import { ForbiddenScreen } from "@/components/routes/forbidden-screen";

/** `forbidden()` from a layout (src/lib/server/principal.ts): a real 403 with the Forbidden screen. */
export default function Forbidden() {
  return <ForbiddenScreen />;
}
