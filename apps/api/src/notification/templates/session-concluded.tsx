import { Button, Heading, Text } from "@react-email/components";
import React from "react";
import { BaseEmail } from "./base-email.js";
import type { SessionConcludedPayload } from "../catalog.js";

interface Props {
  payload: SessionConcludedPayload;
  unsubscribeUrl: string;
}

export function SessionConcludedEmail({ payload, unsubscribeUrl }: Props) {
  const price = `$${(payload.agreedPriceMinor / 100).toLocaleString("en-US")} ${payload.currency}`;
  const preview = `Your agent negotiated ${payload.listingTitle} to ${price}. Ready to accept?`;
  const sessionUrl = `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/negotiations/${payload.sessionId}`;

  return (
    <BaseEmail preview={preview} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={heading}>Your agent got a deal!</Heading>
      <Text style={body}>
        Your AI agent negotiated <strong>{payload.listingTitle}</strong> down to{" "}
        <strong>{price}</strong>. Review the result and decide whether to accept.
      </Text>
      <Button href={sessionUrl} style={button}>
        Review & Accept
      </Button>
    </BaseEmail>
  );
}

const heading = { fontSize: "24px", fontWeight: "700", color: "#f1f5f9", margin: "0 0 16px" };
const body = { fontSize: "16px", color: "#94a3b8", lineHeight: "1.6", margin: "0 0 24px" };
const button = {
  backgroundColor: "#06b6d4",
  color: "#0f172a",
  padding: "12px 24px",
  borderRadius: "8px",
  fontWeight: "600",
  textDecoration: "none",
  display: "inline-block",
};
