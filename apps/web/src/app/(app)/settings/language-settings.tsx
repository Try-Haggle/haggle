"use client";

import { Field, Select } from "@/components/ui";
import { isLocale, LOCALE_NATIVE_NAME, LOCALES, type Locale } from "@/lib/i18n";
import { useLocale } from "@/providers/locale-provider";

/**
 * Account display language. Default English; other locales are additive.
 */
export function LanguageSettings() {
  const { locale, setLocale, t } = useLocale();

  return (
    <section
      data-testid="language-settings"
      className="rounded-xl border border-line bg-surface-raised p-4 sm:p-6 mb-6"
    >
      <h2 className="text-base sm:text-lg font-semibold text-ink mb-1">
        {t("settings.language.title")}
      </h2>
      <p className="text-sm text-ink-muted mb-4">{t("settings.language.hint")}</p>
      <Field label={t("settings.language.label")} htmlFor="display-language">
        <Select
          id="display-language"
          value={locale}
          onChange={(event) => {
            if (isLocale(event.target.value)) setLocale(event.target.value as Locale);
          }}
          aria-label={t("settings.language.label")}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_NATIVE_NAME[code]}
            </option>
          ))}
        </Select>
      </Field>
    </section>
  );
}
