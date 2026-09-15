"use client";

import { formatMoney } from "@haggle/shared";
import { FileText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { useLocale } from "@/providers/locale-provider";
import {
  type CheckoutAgreementDisplay,
  isFullAgreementRenderable,
} from "./checkout-full-agreement";

function money(currency: string, amount_minor: number) {
  return formatMoney({ currency, amount_minor });
}

export function CheckoutFullAgreement({
  agreement,
  leaveHref,
  onConfirm,
}: {
  agreement: CheckoutAgreementDisplay;
  leaveHref: string;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  const ready = isFullAgreementRenderable(agreement);
  const fees = agreement.fees;

  return (
    <div className="space-y-6" data-testid="checkout-full-agreement">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-semibold text-ink text-lg">
          <FileText className="size-5 text-action-primary" />
          {t("checkout.fullAgreement.title")}
        </h2>
        <p className="text-ink-secondary text-sm">{t("checkout.fullAgreement.subtitle")}</p>
      </div>

      <section className="space-y-2" aria-labelledby="cfa-price">
        <h3 id="cfa-price" className="font-medium text-ink text-sm">
          {t("checkout.fullAgreement.price")}
        </h3>
        <p className="font-semibold text-action-primary text-xl tabular-nums">
          {money(agreement.currency, agreement.price_minor)}
        </p>
      </section>

      <section className="space-y-2" aria-labelledby="cfa-address">
        <h3 id="cfa-address" className="font-medium text-ink text-sm">
          {t("checkout.fullAgreement.address")}
        </h3>
        <div className="rounded-lg border border-line bg-surface-sunken/40 px-3 py-2 text-ink text-sm">
          {agreement.address.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="cfa-fulfillment">
        <h3 id="cfa-fulfillment" className="font-medium text-ink text-sm">
          {t("checkout.fullAgreement.fulfillment")}
        </h3>
        <p className="text-ink text-sm">{agreement.fulfillment_summary}</p>
      </section>

      <section className="space-y-2" aria-labelledby="cfa-fees">
        <h3 id="cfa-fees" className="font-medium text-ink text-sm">
          {t("checkout.fullAgreement.fees")}
        </h3>
        <dl className="space-y-1.5 rounded-lg border border-line px-3 py-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">{t("checkout.fullAgreement.item")}</dt>
            <dd className="tabular-nums text-ink">{money(agreement.currency, fees.item_minor)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">{t("checkout.fullAgreement.shipping")}</dt>
            <dd className="tabular-nums text-ink">
              {agreement.shipping_cost_minor == null
                ? t("checkout.fullAgreement.shippingNa")
                : money(agreement.currency, fees.shipping_minor)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">{t("checkout.fullAgreement.feeWallet")}</dt>
            <dd className="tabular-nums text-ink">
              {money(agreement.currency, fees.haggle_fee_minor)} (1.5%)
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">{t("checkout.fullAgreement.feeCard")}</dt>
            <dd className="tabular-nums text-ink">
              {money(agreement.currency, fees.card_fee_minor)} (3.0%)
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-line border-t pt-1.5 font-medium">
            <dt className="text-ink">{t("checkout.fullAgreement.buyerPaysWallet")}</dt>
            <dd className="tabular-nums text-ink">
              {money(agreement.currency, fees.buyer_pays_wallet_minor)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 font-medium">
            <dt className="text-ink">{t("checkout.fullAgreement.buyerPaysCard")}</dt>
            <dd className="tabular-nums text-ink">
              {money(agreement.currency, fees.buyer_pays_card_minor)}
            </dd>
          </div>
          <p className="pt-1 text-ink-muted text-xs">{t("checkout.fullAgreement.feeNote")}</p>
        </dl>
      </section>

      <section className="space-y-2" aria-labelledby="cfa-criteria">
        <h3 id="cfa-criteria" className="font-medium text-ink text-sm">
          {t("checkout.fullAgreement.criteria")}
        </h3>
        {agreement.criteria.length === 0 ? (
          <p className="text-ink-secondary text-sm">{t("checkout.fullAgreement.criteriaNone")}</p>
        ) : (
          <ul className="space-y-2">
            {agreement.criteria.map((c) => (
              <li key={c.check_id} className="rounded-lg border border-line px-3 py-2 text-sm">
                <p className="font-medium text-ink">{c.label}</p>
                {c.seller_value ? (
                  <p className="mt-0.5 text-ink-secondary">
                    {t("checkout.fullAgreement.sellerValue")}: {c.seller_value}
                  </p>
                ) : null}
                {c.buyer_stance ? (
                  <p className="mt-0.5 text-ink-secondary">
                    {t("checkout.fullAgreement.buyerAnswer")}: {c.buyer_stance}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="space-y-3 pt-2">
        <Button
          type="button"
          fullWidth
          disabled={!ready}
          onClick={onConfirm}
          data-testid="checkout-pay-as-agreed"
        >
          {t("checkout.fullAgreement.cta")}
        </Button>
        <p className="text-center text-ink-muted text-xs">
          {t("checkout.fullAgreement.changeHint")}{" "}
          <Link href={leaveHref} className="text-action-primary underline-offset-2 hover:underline">
            {t("checkout.fullAgreement.leave")}
          </Link>
        </p>
      </div>
    </div>
  );
}
