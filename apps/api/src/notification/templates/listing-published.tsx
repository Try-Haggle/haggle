import { Button, Heading, Text } from "@react-email/components";
import React from "react";
import { BaseEmail } from "./base-email.js";
import type { ListingPublishedPayload } from "../catalog.js";

interface Props {
  payload: ListingPublishedPayload;
  unsubscribeUrl: string;
}

export function ListingPublishedEmail({ payload, unsubscribeUrl }: Props) {
  const price = `$${(payload.listingPriceMinor / 100).toLocaleString("en-US")} ${payload.currency}`;
  const preview = `Your listing "${payload.listingTitle}" is now live!`;
  const listingUrl = `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/listings/${payload.listingId}`;

  return (
    <BaseEmail preview={preview} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={heading}>Your listing is live!</Heading>
      <Text style={body}>
        Hi {payload.sellerName}, your listing <strong>{payload.listingTitle}</strong>{" "}
        has been published at <strong>{price}</strong>. Buyers can now find and
        make offers on it.
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
