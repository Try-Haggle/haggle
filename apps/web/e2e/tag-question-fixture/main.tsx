import { NEGOTIATION_AGENT_PRESETS } from "@haggle/shared";
import { createRoot } from "react-dom/client";
import { NegotiationAgentBuilderChat } from "../../src/app/l/[publicId]/negotiation-agent-builder-chat";
import "../../src/app/globals.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <NegotiationAgentBuilderChat
      agent={NEGOTIATION_AGENT_PRESETS[0]!}
      listingPublicId="builder-tag-questions"
      listingTitle="iPhone 15 Pro"
      listingCategory="electronics"
      listingPrice="850"
      listingTags={["iphone-15-pro"]}
    />,
  );
}
