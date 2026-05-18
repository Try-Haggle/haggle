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
  const preview = `${payload.buyerName} accepted the deal on ${payload.listingTitle}!`;
  const listingUrl = `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/sell/listings/${payload.listingId}`;

  return (
    <BaseEmail preview={preview} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={heading}>You have a buyer! 🎉</Heading>
      <Text style={body}>
        <strong>{payload.buyerName}</strong> accepted the deal on{" "}
        <strong>{payload.listingTitle}</strong> for <strong>{price}</strong>.
        Proceed to shipping to complete the transaction.
      </Text>
      <Button href={listingUrl} style={button}>
        View Listing
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
