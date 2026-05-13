import { NewAgentForm } from "../../../sell/agents/new/NewAgentForm";

interface NewAgentPageProps {
  searchParams: Promise<{ preset?: string }>;
}

export default async function NewBuyAgentPage({
  searchParams,
}: NewAgentPageProps) {
  const { preset } = await searchParams;
  return <NewAgentForm role="buyer" initialPresetId={preset} />;
}

export const metadata = {
  title: "Create Buying Agent | Haggle",
  description: "Pick a negotiation style and customize.",
};
