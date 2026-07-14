import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/admin-api";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/claim");
  }

  if (!isAdminRole(user)) {
    redirect("/sign-in");
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between border-b border-line pb-4">
        <h1 className="text-2xl font-semibold text-ink">Admin Console</h1>
        <nav className="flex gap-4 text-sm text-ink-secondary">
          <Link href="/admin" className="hover:text-ink">
            Inbox
          </Link>
          <Link href="/admin/promotion-rules" className="hover:text-ink">
            Promotion Rules
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
