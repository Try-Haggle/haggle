import { ChatBubble, TypingIndicator } from "@/components/ui/chat-bubble";
import { cn } from "@/lib/cn";
import type { Story } from "./types";

export const chatBubbleStory: Story = {
  slug: "chat-bubble",
  name: "ChatBubble",
  componentName: "ChatBubble",
  controls: {
    withAuthor: { type: "boolean", default: true },
    withTyping: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className={cn("w-96 max-w-full space-y-2", className)}>
      <ChatBubble side="left" author={a.withAuthor ? "Agent Sage" : undefined} footer="14:02">
        $850까지 맞춰드릴 수 있어요. 어떠세요?
      </ChatBubble>
      <ChatBubble side="right" footer="14:03">
        $820이면 바로 진행할게요.
      </ChatBubble>
      {(a.withTyping as boolean) && (
        <ChatBubble side="left" author={a.withAuthor ? "Agent Sage" : undefined}>
          <TypingIndicator />
        </ChatBubble>
      )}
    </div>
  ),
};
