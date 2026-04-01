import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email ?? "").trim().toLowerCase();
    const source = body.source ?? "landing";

    if (!email || !email.includes("@") || !email.includes(".")) {
      return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });
    }

    const supabase = await createClient();

    // Upsert — ignore if email already exists
    const { error } = await supabase.from("waitlist").upsert(
      { email, source },
      { onConflict: "email", ignoreDuplicates: true },
    );

    if (error) {
      console.error("Waitlist insert error:", error);
      return NextResponse.json({ success: false, error: "Failed to join waitlist" }, { status: 500 });
    }

    // Get total count
    const { count } = await supabase
      .from("waitlist")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({ success: true, count: count ?? 0 });
  } catch {
    return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("waitlist")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({ count: count ?? 0 });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
