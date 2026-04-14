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
        <p className="text-sm text-slate-500 italic text-center max-w-md px-4 py-2">
          {content}
        </p>
      </div>
    );
  }

  const isBuyer = role === "buyer";

  return (
    <div
      className={`flex ${isBuyer ? "justify-start" : "justify-end"} animate-fade-in`}
    >
      <div
        className={`rounded-xl px-4 py-3 max-w-sm sm:max-w-md ${
          isBuyer
            ? "bg-slate-800 border border-slate-700"
            : "bg-cyan-500/10 border border-cyan-500/20"
        }`}
      >
        <p className="text-xs text-slate-500 mb-1">
          {isBuyer ? "🤖 AI Buyer" : "You (Seller)"}
        </p>
        <p className="text-sm text-slate-200 whitespace-pre-wrap">{content}</p>
        {price != null && (
          <p
            className={`text-lg font-bold mt-1 ${isBuyer ? "text-blue-400" : "text-cyan-400"}`}
          >
            ${(price / 100).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
