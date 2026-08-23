import { redirect } from "next/navigation";

/**
 * Editing happens inside the Agent Studio now — the agent id selects the
 * thread instead of opening a separate page. Kept as a redirect so existing
 * links and bookmarks still resolve.
 */
export default async function EditSellAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sell/agents?agent=${encodeURIComponent(id)}`);
}
