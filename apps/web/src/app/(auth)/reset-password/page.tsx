import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Reached from the reset email: /auth/callback exchanges the link's code for
 * a short-lived session, then lands here. Without that session — the link
 * expired, was already used, or was opened in another browser — updating the
 * password can only fail, so say so up front instead of letting someone type
 * a new password twice and then see "Auth session missing!".
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <ExpiredLink />;
  return <ResetPasswordForm />;
}

function ExpiredLink() {
  return (
    <main className="flex min-h-[calc(100dvh-var(--spacing-header))] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="space-y-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-line bg-surface-sunken">
            <LinkIcon className="size-7 text-ink-secondary" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h1 className="font-bold text-3xl text-ink tracking-tight">This link has expired</h1>
          <p className="text-base text-ink-secondary">
            Reset links work once and only for a short time. Request a new one and open it in this
            browser.
          </p>
        </div>
        <Link href="/forgot-password" className={buttonVariants({ size: "lg", fullWidth: true })}>
          Get a new link
        </Link>
      </div>
    </main>
  );
}
