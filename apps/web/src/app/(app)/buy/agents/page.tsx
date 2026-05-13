import { AgentsList } from "../../sell/agents/_components/AgentsList";

export default function BuyAgentsPage() {
  return <AgentsList role="buyer" />;
}

export const metadata = {
  title: "Buying Agents | Haggle",
  description: "Manage your buyer-side negotiation agents.",
};
