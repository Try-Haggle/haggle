import { redirect } from "next/navigation";
import { Suspense } from "react";
import { postSignInPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { SignInForm } from "./sign-in-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The signed-in check runs here, on the server, before any HTML is sent: a
 * visitor who is already signed in is redirected without ever seeing the
 * form, and everyone else gets the form in the first paint. Doing the check
 * in the browser meant hiding the form behind a blank screen until a network
 * round-trip came back — for every visitor, to serve the rare signed-in one.
 */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
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
      <SignInForm />
    </Suspense>
  );
}
