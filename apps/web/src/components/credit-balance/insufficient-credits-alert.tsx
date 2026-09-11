"use client";

import { Alert } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  formatInsufficientCreditsMessage,
  type InsufficientCreditsInfo,
} from "@/lib/credit-balance";

export interface InsufficientCreditsAlertProps {
  info: InsufficientCreditsInfo;
  className?: string;
}

/**
 * Insufficient Soft credits gate (credit-ledger-sot.md §6).
 * Shown at start / Auto ON when the server refuses Soft AI charge.
 */
export function InsufficientCreditsAlert({ info, className }: InsufficientCreditsAlertProps) {
  return (
    <Alert
      tone="error"
      className={cn("text-sm", className)}
      data-testid="insufficient-credits-alert"
      data-code={info.code}
    >
      {formatInsufficientCreditsMessage(info)}
    </Alert>
  );
}
