import type { Metadata } from "next";
import { isDemoCheckoutEnabled } from "@/lib/demo-checkout";
import { DeveloperDemo } from "./developer-demo";

export const metadata: Metadata = {
  title: "Developer Pipeline Demo | Haggle",
  description: "See the 6-Stage LLM negotiation pipeline in action",
};

export default function Page() {
  return <DeveloperDemo checkoutEnabled={isDemoCheckoutEnabled()} />;
}
