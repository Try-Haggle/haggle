export interface CheckoutApprovalSummary {
  id: string;
  buyer_id: string;
  approval_state: string;
  final_amount_minor?: string | number;
}

interface CheckoutCtaInput {
  sessionId: string;
  sessionStatus: string;
  userId: string | null;
  approval?: CheckoutApprovalSummary;
}

export function getCheckoutCta(input: CheckoutCtaInput):
  | {
      href: string;
      label: string;
    }
  | undefined {
  if (input.sessionStatus !== "ACCEPTED") return undefined;

  if (!input.userId) {
    const claimPath = `/claim/buyer?session_id=${input.sessionId}`;
    return {
      href: `/sign-up?next=${encodeURIComponent(claimPath)}`,
      label: "Sign up to checkout",
    };
  }

  if (
    input.approval?.id !== input.sessionId ||
    input.approval.buyer_id !== input.userId ||
    input.approval.approval_state !== "APPROVED"
  ) {
    return undefined;
  }

  return {
    href: `/buy/negotiations/${input.sessionId}/checkout`,
    label: "Continue to checkout",
  };
}

export function toPositiveMinor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

interface CheckoutReadyInput {
  sessionId: string;
  sessionStatus: string;
  negotiatedAmountMinor: string | number | null;
  hasListing: boolean;
  userId: string;
  approval: CheckoutApprovalSummary;
}

export function isCheckoutReady(input: CheckoutReadyInput): boolean {
  const approvedAmount = toPositiveMinor(input.approval.final_amount_minor);
  return (
    input.sessionStatus === "ACCEPTED" &&
    input.approval.id === input.sessionId &&
    input.approval.buyer_id === input.userId &&
    input.approval.approval_state === "APPROVED" &&
    approvedAmount !== null &&
    toPositiveMinor(input.negotiatedAmountMinor) === approvedAmount &&
    input.hasListing
  );
}
