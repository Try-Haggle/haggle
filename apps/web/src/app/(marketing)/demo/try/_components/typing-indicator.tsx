"use client";

export function TypingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="rounded-xl px-4 py-3 bg-slate-800 border border-slate-700">
        <p className="text-xs text-slate-500 mb-1">🤖 AI Buyer</p>
        <div className="flex items-center gap-1.5 h-5">
          <span
            className="w-2 h-2 rounded-full bg-slate-500"
            style={{
              animation: "typing-bounce 1.4s ease-in-out infinite",
              animationDelay: "0ms",
            }}
          />
          <span
            className="w-2 h-2 rounded-full bg-slate-500"
            style={{
              animation: "typing-bounce 1.4s ease-in-out infinite",
              animationDelay: "200ms",
            }}
          />
          <span
            className="w-2 h-2 rounded-full bg-slate-500"
            style={{
              animation: "typing-bounce 1.4s ease-in-out infinite",
              animationDelay: "400ms",
            }}
          />
        </div>
      </div>
    </div>
  );
}
