import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import React from "react";

interface BaseEmailProps {
  preview: string;
  unsubscribeUrl: string;
  children: React.ReactNode;
}

export function BaseEmail({ preview, unsubscribeUrl, children }: BaseEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={brandName}>Haggle</Text>
          </Section>

          {/* Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              You received this email because you have an account on{" "}
              <Link href="https://tryhaggle.ai" style={link}>
                Haggle
              </Link>
              .{" "}
              <Link href={unsubscribeUrl} style={link}>
                Unsubscribe
              </Link>
            </Text>
            <Text style={footerText}>Haggle · tryhaggle.ai</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#0f172a", fontFamily: "sans-serif" };
const container = { maxWidth: "580px", margin: "0 auto", padding: "20px 0" };
const header = { padding: "20px 24px", borderBottom: "1px solid #1e293b" };
const brandName = { fontSize: "20px", fontWeight: "700", color: "#06b6d4", margin: "0" };
const content = { padding: "32px 24px" };
const footer = { padding: "20px 24px", borderTop: "1px solid #1e293b" };
const footerText = { fontSize: "12px", color: "#64748b", margin: "4px 0" };
const link = { color: "#06b6d4", textDecoration: "underline" };
