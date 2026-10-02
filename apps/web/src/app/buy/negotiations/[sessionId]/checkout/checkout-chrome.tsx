"use client";

import { LockKeyhole } from "lucide-react";
import { Badge, PageHeader, Select } from "@/components/ui";
import { isLocale, LOCALE_NATIVE_NAME, LOCALES } from "@/lib/i18n";
import { useLocale } from "@/providers/locale-provider";
import { checkoutCopy } from "../checkout-copy";

export function CheckoutText({
  message,
}: {
  message: "negotiatedPrice" | "fundsNote" | "buyerNote";
}) {
  const { locale } = useLocale();
  return checkoutCopy(locale)[message];
}

export function CheckoutHeader({ sessionId }: { sessionId: string }) {
  const { locale, setLocale } = useLocale();
  const copy = checkoutCopy(locale);
  return (
    <>
      <PageHeader
        icon={<LockKeyhole className="size-6" />}
        title={copy.title}
        subtitle={copy.subtitle}
        backHref={`/buy/negotiations/${sessionId}`}
        backLabel={copy.back}
        actions={
          <Badge tone="success" dot>
            {copy.accepted}
          </Badge>
        }
      />
      <div className="mb-6 flex items-center justify-end gap-2 text-sm">
        <label htmlFor="checkout-language" className="text-ink-secondary">
          {copy.language}
        </label>
        <Select
          id="checkout-language"
          value={locale}
          className="w-auto"
          onChange={(event) => {
            if (isLocale(event.target.value)) setLocale(event.target.value);
          }}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_NATIVE_NAME[code]}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}
