import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/admin-api";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/claim");
  }

  if (!isAdminRole(user)) {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between border-b border-neutral-200 pb-4">
        <h1 className="text-2xl font-semibold text-neutral-900">Admin Console</h1>
        <nav className="flex gap-4 text-sm text-neutral-600">
          <Link href="/admin" className="hover:text-neutral-900">
            Inbox
          </Link>
          <Link
            href="/admin/promotion-rules"
            className="hover:text-neutral-900"
          >
            Promotion Rules
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
