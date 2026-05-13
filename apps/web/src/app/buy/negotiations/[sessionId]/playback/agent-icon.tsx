import type { AgentCard } from "./types";

interface AgentIconProps {
  agent: AgentCard;
  size?: number;
}

export function AgentIcon({ agent, size = 18 }: AgentIconProps) {
  return (
    <span
      style={{ fontSize: size, lineHeight: 1, display: "inline-block" }}
      aria-hidden="true"
    >
      {agent.emoji}
    </span>
  );
}
