import type { Metadata } from "next";
import { UserDemo } from "./user-demo";

export const metadata: Metadata = {
  title: "Try AI Negotiation | Haggle",
  description:
    "Experience AI-powered negotiation firsthand. Haggle's AI wants to buy your iPhone — how much will you sell it for?",
};

export default function Page() {
  return <UserDemo />;
}
