import { redirect } from "next/navigation";
import { Suspense } from "react";
import { postSignInPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { SignUpForm } from "./sign-up-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Same shape as the sign-in page: the signed-in check runs on the server, so
 * a signed-in visitor is redirected before any HTML is sent and everyone else
 * gets the form in the first paint — no blank screen while the browser asks.
 */
export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const params = await searchParams;
    redirect(postSignInPath(first(params.token), first(params.next)));
  }

  return (
    // useSearchParams needs a boundary; the page is dynamic, so the form is
    // still server-rendered and this fallback never shows.
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}
