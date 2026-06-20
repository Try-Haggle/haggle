import { ChatBubble } from "@/components/ui/chat-bubble";
import { MessageList } from "@/components/ui/message-list";
import type { Story } from "./types";

const MESSAGES = [
  { side: "left", author: "Agent Sage", text: "안녕하세요! 협상을 시작할게요." },
  { side: "right", text: "$820 목표예요." },
  { side: "left", author: "Agent Sage", text: "판매자는 $900을 불렀어요." },
  { side: "right", text: "$850까지는 가능." },
  { side: "left", author: "Agent Sage", text: "$860에 합의 봤습니다 👍" },
  { side: "right", text: "좋아요, 진행!" },
] as const;

export const messageListStory: Story = {
  slug: "message-list",
  name: "MessageList",
  componentName: "MessageList",
  controls: {
    autoScroll: { type: "boolean", default: true },
  },
  render: (a, className) => (
    <div className="w-96 max-w-full">
      <MessageList autoScroll={a.autoScroll as boolean} className={className ?? "max-h-64 pr-1"}>
        {MESSAGES.map((m) => (
          <ChatBubble key={m.text} side={m.side} author={"author" in m ? m.author : undefined}>
            {m.text}
          </ChatBubble>
        ))}
      </MessageList>
    </div>
  ),
};
