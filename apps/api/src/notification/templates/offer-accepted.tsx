import { Button, Heading, Text } from "@react-email/components";
import React from "react";
import { BaseEmail } from "./base-email.js";
import type { OfferAcceptedPayload } from "../catalog.js";

interface Props {
  payload: OfferAcceptedPayload;
  unsubscribeUrl: string;
}

export function OfferAcceptedEmail({ payload, unsubscribeUrl }: Props) {
  const price = `$${(payload.agreedPriceMinor / 100).toLocaleString("en-US")} ${payload.currency}`;
  const preview = `Your offer on ${payload.listingTitle} was accepted!`;
  const sessionUrl = `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/negotiations/${payload.sessionId}`;

  return (
    <BaseEmail preview={preview} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={heading}>Your offer was accepted! 🎉</Heading>
      <Text style={body}>
        <strong>{payload.acceptedByUserName}</strong> accepted your offer of{" "}
        <strong>{price}</strong> on <strong>{payload.listingTitle}</strong>.
      </Text>
      <Button href={sessionUrl} style={button}>
        Proceed to Checkout
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
