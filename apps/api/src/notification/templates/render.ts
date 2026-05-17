import { render } from "@react-email/render";
import React from "react";
import type { EventType } from "../catalog.js";
import { OfferReceivedEmail } from "./offer-received.js";
import { OfferAcceptedEmail } from "./offer-accepted.js";
import { UserSignedUpEmail } from "./user-signed-up.js";
import { ListingPublishedEmail } from "./listing-published.js";
import type {
  OfferReceivedPayload,
  OfferAcceptedPayload,
  UserSignedUpPayload,
  ListingPublishedPayload,
} from "../catalog.js";

interface RenderResult {
  subject: string;
  html: string;
}

function makeUnsubscribeUrl(userId: string): string {
  const secret = process.env.NOTIFICATION_UNSUBSCRIBE_SECRET ?? "dev-secret";
  // HMAC signing happens in the route handler — here we just pass userId as placeholder
  // In production, this URL is generated with a signed token from the bus
  return `${process.env.PUBLIC_APP_URL ?? "https://tryhaggle.ai"}/api/notifications/unsubscribe?userId=${userId}`;
}

export async function renderEmailTemplate(
  eventType: EventType,
  payload: Record<string, unknown>,
  recipientUserId = "",
): Promise<RenderResult> {
  const unsubscribeUrl = makeUnsubscribeUrl(recipientUserId);

  switch (eventType) {
    case "negotiation.offer.received": {
      const html = await render(
        React.createElement(OfferReceivedEmail, {
          payload: payload as OfferReceivedPayload,
          unsubscribeUrl,
        }),
      );
      const p = payload as OfferReceivedPayload;
      return {
        subject: `New ${p.offerType === "COUNTER" ? "counter offer" : "offer"} on ${p.listingTitle}`,
        html,
      };
    }

    case "negotiation.offer.accepted": {
      const html = await render(
        React.createElement(OfferAcceptedEmail, {
          payload: payload as OfferAcceptedPayload,
          unsubscribeUrl,
        }),
      );
      const p = payload as OfferAcceptedPayload;
      return { subject: `Your offer on ${p.listingTitle} was accepted!`, html };
    }

    case "user.signed_up": {
      const html = await render(
        React.createElement(UserSignedUpEmail, {
          payload: payload as UserSignedUpPayload,
          unsubscribeUrl,
        }),
      );
      const p = payload as UserSignedUpPayload;
      return { subject: `Welcome to Haggle, ${p.userName}!`, html };
    }

    case "listing.published": {
      const html = await render(
        React.createElement(ListingPublishedEmail, {
          payload: payload as ListingPublishedPayload,
          unsubscribeUrl,
        }),
      );
      const p = payload as ListingPublishedPayload;
      return { subject: `Your listing "${p.listingTitle}" is now live!`, html };
    }
  }
}
