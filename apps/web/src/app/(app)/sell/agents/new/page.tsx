import { redirect } from "next/navigation";

/**
 * The standalone "new agent" page is gone — the Agent Studio creates and edits
 * in one place, so starting from a preset is just selecting it in the roster.
 *
 * Kept as a redirect rather than deleted: `?preset=` links are still emitted by
 * the embedded preset picker inside AgentBuilder, which the seller listing
 * wizard and the v1 listing page still use. Those clicks are intercepted, but
 * an opened-in-a-new-tab link should land on the right thread, not a 404.
 */
export default async function NewSellAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string }>;
}) {
  const { preset } = await searchParams;
  redirect(preset ? `/sell/agents?preset=${encodeURIComponent(preset)}` : "/sell/agents");
}
