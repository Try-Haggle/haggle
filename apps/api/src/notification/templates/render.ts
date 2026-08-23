import { render } from "@react-email/render";
import React from "react";
import type {
  EventType,
  ListingPublishedPayload,
  OfferAcceptedPayload,
  SessionConcludedPayload,
  UserSignedUpPayload,
} from "../catalog.js";
import { ListingPublishedEmail } from "./listing-published.js";
import { OfferAcceptedEmail } from "./offer-accepted.js";
import { SessionConcludedEmail } from "./session-concluded.js";
import { UserSignedUpEmail } from "./user-signed-up.js";

interface RenderResult {
  subject: string;
  html: string;
}

function makeUnsubscribeUrl(userId: string): string {
  return `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/api/notifications/unsubscribe?userId=${userId}`;
}

export async function renderEmailTemplate(
  eventType: EventType,
  payload: Record<string, unknown>,
  recipientUserId = "",
): Promise<RenderResult> {
  const unsubscribeUrl = makeUnsubscribeUrl(recipientUserId);

  switch (eventType) {
    case "negotiation.session.concluded": {
      const p = payload as SessionConcludedPayload;
      const html = await render(
        React.createElement(SessionConcludedEmail, { payload: p, unsubscribeUrl }),
      );
      return {
        subject: `Your agent got a deal on ${p.listingTitle} — $${(p.agreedPriceMinor / 100).toLocaleString("en-US")}`,
        html,
      };
    }

    case "negotiation.offer.accepted": {
      const p = payload as OfferAcceptedPayload;
      const html = await render(
        React.createElement(OfferAcceptedEmail, { payload: p, unsubscribeUrl }),
      );
      return { subject: `${p.buyerName} accepted the deal on ${p.listingTitle}!`, html };
    }

    case "user.signed_up": {
      const p = payload as UserSignedUpPayload;
      const html = await render(
        React.createElement(UserSignedUpEmail, { payload: p, unsubscribeUrl }),
      );
      return { subject: `Welcome to Haggle, ${p.userName}!`, html };
    }

    case "listing.published": {
      const p = payload as ListingPublishedPayload;
      const html = await render(
        React.createElement(ListingPublishedEmail, { payload: p, unsubscribeUrl }),
      );
      return { subject: `Your listing "${p.listingTitle}" is now live!`, html };
    }
  }
}
