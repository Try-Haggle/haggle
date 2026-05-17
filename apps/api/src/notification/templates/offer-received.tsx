import { Button, Heading, Text } from "@react-email/components";
import React from "react";
import { BaseEmail } from "./base-email.js";
import type { OfferReceivedPayload } from "../catalog.js";

interface Props {
  payload: OfferReceivedPayload;
  unsubscribeUrl: string;
}

export function OfferReceivedEmail({ payload, unsubscribeUrl }: Props) {
  const price = `$${(payload.offerPriceMinor / 100).toLocaleString("en-US")} ${payload.currency}`;
  const offerLabel = payload.offerType === "COUNTER" ? "counter offer" : "new offer";
  const preview = `${payload.fromUserName} sent a ${offerLabel} on ${payload.listingTitle}`;
  const sessionUrl = `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/negotiations/${payload.sessionId}`;

  return (
    <BaseEmail preview={preview} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={heading}>You have a {offerLabel}</Heading>
      <Text style={body}>
        <strong>{payload.fromUserName}</strong> sent a {offerLabel} of{" "}
        <strong>{price}</strong> on <strong>{payload.listingTitle}</strong>.
      </Text>
      <Button href={sessionUrl} style={button}>
        View Offer
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
