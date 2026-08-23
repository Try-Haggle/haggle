"use client";

import { InboxTabs } from "./_components/InboxTabs";
import { SummaryCards } from "./_components/SummaryCards";

export default function AdminInboxPage() {
  return (
    <div>
      <SummaryCards />
      <InboxTabs />
    </div>
  );
}
