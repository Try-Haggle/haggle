import { AgentsList } from "./_components/AgentsList";

export default function SellAgentsPage() {
  return <AgentsList role="seller" />;
}

export const metadata = {
  title: "Selling Agents | Haggle",
  description: "Manage your seller-side negotiation agents.",
};
