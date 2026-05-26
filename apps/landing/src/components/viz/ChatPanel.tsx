/**
 * Step 02 viz — Two agents (Hugo ↔ Pepper) negotiating.
 * Static for Phase 3 — all 4 messages visible, banner visible, no confetti.
 * Animation timeline (typing → reveal → banner → confetti) added in Phase 5.
 */
import { AGENTS } from "@/lib/data/agents";

type Sender = "hugo" | "pepper";

interface Message {
  sender: Sender;
  text: React.ReactNode;
}

const MESSAGES: Message[] = [
  { sender: "hugo", text: "How long have you had it?" },
  {
    sender: "pepper",
    text: (
      <>
        8 months. Always in a case. Battery at{" "}
        <span className="font-mono text-[12.5px] font-medium tracking-[0.01em]">
          91%
        </span>
        .
      </>
    ),
  },
  {
    sender: "hugo",
    text: (
      <>
        Fair. I can do{" "}
        <span className="font-mono text-[12.5px] font-medium tracking-[0.01em]">
          $750
        </span>
        .
      </>
    ),
  },
  {
    sender: "pepper",
    text: (
      <>
        Meet at{" "}
        <span className="font-mono text-[12.5px] font-medium tracking-[0.01em]">
          $785
        </span>
        ? Original box included.
      </>
    ),
  },
];

function Avatar({ sender }: { sender: Sender }) {
  const agent = AGENTS[sender];
  const bg = sender === "hugo" ? "bg-[#F6E6CC]" : "bg-[#EAF4ED]";
  return (
    <span
      className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center overflow-hidden rounded-full ${bg}`}
      dangerouslySetInnerHTML={{ __html: agent.svg }}
    />
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isHugo = msg.sender === "hugo";
  return (
    <div
      className={`flex max-w-[78%] flex-col gap-1 ${
        isHugo ? "self-start items-start" : "self-end items-end"
      }`}
    >
      <div
        className={`flex items-center gap-[7px] px-0.5 ${
          isHugo ? "" : "flex-row-reverse"
        }`}
      >
        <Avatar sender={msg.sender} />
        <span className="font-mono text-[10px] font-medium tracking-[0.14em] text-neutral-600 uppercase">
          {isHugo ? "Hugo" : "Pepper"}
        </span>
      </div>
      <div
        className={`px-[13px] py-[9px] text-[13px] leading-[1.45] tracking-[-0.005em] ${
          isHugo
            ? "rounded-[14px_14px_14px_4px] bg-navy-500 text-white"
            : "rounded-[14px_14px_4px_14px] border border-[color-mix(in_oklab,var(--color-gold-200)_50%,transparent)] bg-gold-50 text-navy-500"
        }`}
      >
        {msg.text}
      </div>
    </div>
  );
}

export function ChatPanel() {
  return (
    <div className="relative w-full font-sans">
      <div className="relative">
        <div className="relative flex flex-col gap-3.5">
          {MESSAGES.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
        </div>
      </div>
    </div>
  );
}
