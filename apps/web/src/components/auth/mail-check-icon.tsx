import { Mail } from "lucide-react";

/** The round envelope badge on the "Check your email" screens. */
export function MailCheckIcon() {
  return (
    <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-success/20 bg-success-soft">
      <Mail className="size-7 text-success" strokeWidth={1.5} aria-hidden="true" />
    </div>
  );
}
