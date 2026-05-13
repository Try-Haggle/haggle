import { NewAgentForm } from "./NewAgentForm";

interface NewAgentPageProps {
  searchParams: Promise<{ preset?: string }>;
}

export default async function NewSellAgentPage({
  searchParams,
}: NewAgentPageProps) {
  const { preset } = await searchParams;
  return <NewAgentForm role="seller" initialPresetId={preset} />;
}

export const metadata = {
  title: "Create Selling Agent | Haggle",
  description: "Pick a negotiation style and customize.",
};
