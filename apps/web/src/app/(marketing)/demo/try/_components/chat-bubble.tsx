"use client";

interface ChatBubbleProps {
  role: "buyer" | "seller" | "system";
  content: string;
  price?: number;
}

export function ChatBubble({ role, content, price }: ChatBubbleProps) {
  if (role === "system") {
    return (
      <div className="flex justify-center animate-fade-in">
        <p className="text-sm text-ink-secondary italic text-center max-w-md px-4 py-2">
          {content}
        </p>
      </div>
    );
  }

  const isBuyer = role === "buyer";

  return (
    <div className={`flex ${isBuyer ? "justify-start" : "justify-end"} animate-fade-in`}>
      <div
        className={`rounded-xl px-4 py-3 max-w-sm sm:max-w-md ${
          isBuyer
            ? "bg-surface-sunken border border-line"
            : "bg-[color-mix(in_srgb,var(--action-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--action-primary)_20%,transparent)]"
        }`}
      >
        <p className="text-xs text-ink-secondary mb-1">
          {isBuyer ? "🤖 AI Buyer" : "You (Seller)"}
        </p>
        <p className="text-sm text-ink whitespace-pre-wrap">{content}</p>
        {price != null && (
          <p className={`text-lg font-bold mt-1 ${isBuyer ? "text-info" : "text-action-primary"}`}>
            ${(price / 100).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
