import { SiteHeader } from "@/components/ui";

/**
 * Shell for the signed-out account pages (sign-in, sign-up, forgot/reset
 * password): the same `SiteHeader` as the signed-in app, logo only. Shown
 * below md too, unlike the app's — these pages have no bottom nav and no
 * other way back to the home page.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader logoHref="/" />
      <div className="pt-header">{children}</div>
    </>
  );
}
