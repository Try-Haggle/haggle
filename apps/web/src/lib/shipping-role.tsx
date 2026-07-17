import type { ReactNode } from "react";

export function canManageSellerShipping(
  currentUserId: string | null,
  sellerId: string | undefined,
): boolean {
  return Boolean(currentUserId && sellerId && currentUserId === sellerId);
}

export function SellerShippingGate({
  isSeller,
  children,
  fallback,
}: {
  isSeller: boolean;
  children: ReactNode;
  fallback: ReactNode;
}) {
  return isSeller ? children : fallback;
}
