import { Button, Heading, Text } from "@react-email/components";
import React from "react";
import { BaseEmail } from "./base-email.js";
import type { UserSignedUpPayload } from "../catalog.js";

interface Props {
  payload: UserSignedUpPayload;
  unsubscribeUrl: string;
}

export function UserSignedUpEmail({ payload, unsubscribeUrl }: Props) {
  const preview = `Welcome to Haggle, ${payload.userName}!`;
  const browseUrl = `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/browse`;

  return (
    <BaseEmail preview={preview} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={heading}>Welcome to Haggle, {payload.userName}!</Heading>
      <Text style={body}>
        You&apos;re now part of the smarter way to buy and sell. Browse listings,
        make offers, and let AI negotiate the best deal for you.
      </Text>
      <Button href={browseUrl} style={button}>
        Start Browsing
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
