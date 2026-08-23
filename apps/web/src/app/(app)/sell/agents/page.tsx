import { AgentStudioPage } from "../../_components/agent-studio-page";

export default function SellAgentsPage() {
  // biome-ignore lint/a11y/useValidAriaRole: "role" is an AgentStudioPage prop (buyer/seller), not an ARIA role
  return <AgentStudioPage role="seller" />;
}

export const metadata = {
  title: "Selling Agents | Haggle",
  description: "Build and manage your seller-side negotiation agents.",
};
