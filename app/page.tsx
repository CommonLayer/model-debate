import { DebateWorkbench } from "@/components/debate-workbench";
import { getPublicDebateDefaults } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const defaults = getPublicDebateDefaults();

  return <DebateWorkbench defaults={defaults} />;
}
