import { AgentStudioPage } from "../../_components/agent-studio-page";

export default function BuyAgentsPage() {
  // biome-ignore lint/a11y/useValidAriaRole: "role" is an AgentStudioPage prop (buyer/seller), not an ARIA role
  return <AgentStudioPage role="buyer" />;
}

export const metadata = {
  title: "Buying Agents | Haggle",
  description: "Build and manage your buyer-side negotiation agents.",
};
