import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SELLER_AGENT_PICK, type SellerAgentPick } from "./seller-agent-pick";
import { SellerAgentStep } from "./seller-agent-step";

// The drawer is a Vaul sheet; its portal and gesture handling are not what is
// under test here, so it renders its children in place while open.
vi.mock("@/components/ui", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui")>();
  return {
    ...original,
    Drawer: ({
      open,
      onClose,
      children,
    }: {
      open: boolean;
      onClose: () => void;
      children: React.ReactNode;
    }) =>
      open ? (
        <div data-testid="drawer">
          <button type="button" onClick={onClose}>
            Close drawer
          </button>
          {children}
        </div>
      ) : null,
  };
});

function Host({
  initial,
  onChange,
  openRequirementCount = 0,
}: {
  initial: SellerAgentPick;
  onChange?: (pick: SellerAgentPick) => void;
  openRequirementCount?: number;
}) {
  const [pick, setPick] = useState(initial);
  return (
    <SellerAgentStep
      pick={pick}
      onPickChange={(next) => {
        setPick(next);
        onChange?.(next);
      }}
      openRequirementCount={openRequirementCount}
    />
  );
}

const hunter: SellerAgentPick = {
  ...EMPTY_SELLER_AGENT_PICK,
  selection: { kind: "preset", id: "hunter" },
};

describe("SellerAgentStep", () => {
  it("tells the seller how many safety questions stand between them and publishing", () => {
    render(<Host initial={hunter} openRequirementCount={2} />);
    expect(
      screen.getByText("Answer 2 required safety questions before publishing."),
    ).toBeInTheDocument();
  });

  it("lets the seller dress the agent — animal and colour — from the drawer", () => {
    const onChange = vi.fn();
    render(<Host initial={hunter} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /fine-tune/i }));
    const drawer = within(screen.getByTestId("drawer"));
    fireEvent.click(drawer.getByRole("button", { name: /avatar/i }));
    fireEvent.click(drawer.getByRole("button", { name: "penguin" }));
    fireEvent.click(drawer.getByRole("button", { name: "teal" }));

    expect(onChange.mock.calls.at(-1)?.[0].identity).toEqual({
      "preset:hunter": { emoji: "penguin", accentColor: "#14b8a6" },
    });
  });

  it("leaves the step behind the drawer untouched until the drawer closes", () => {
    const onChange = vi.fn();
    render(<Host initial={hunter} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /fine-tune/i }));
    // A tuning visit hides the archetype grid; deselect to bring it back, then pick.
    const drawer = within(screen.getByTestId("drawer"));
    expect(drawer.queryByRole("button", { name: /quick closer/i })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(onChange.mock.calls.at(-1)?.[0].selection).toEqual({ kind: "preset", id: "hunter" });
  });

  it.each([
    [
      "a saved agent opens its own conversation, the one the Agents tab shows",
      { kind: "saved", id: "agent-1", presetId: "verifier" } as const,
      (thread: ChatThread) => {
        expect(thread.storageId).toBe("agent-studio:seller:saved:agent-1");
        expect(thread.serverThreadKey).toBe("agent-studio:seller:saved:agent-1");
      },
    ],
    [
      "a preset opens a fresh conversation for this visit, kept out of the database",
      { kind: "preset", id: "hunter" } as const,
      (thread: ChatThread) => {
        expect(thread.storageId).toMatch(/^agent-studio:seller:preset:hunter:/);
        expect(thread.serverThreadKey).toBeUndefined();
      },
    ],
  ])("%s", (_name, selection, check) => {
    const chatSlot = vi.fn<(args: { thread: ChatThread }) => null>(() => null);
    render(
      <SellerAgentStep
        pick={{ ...EMPTY_SELLER_AGENT_PICK, selection }}
        onPickChange={vi.fn()}
        savedAgents={[{ id: "agent-1", name: "Firm lister", emoji: "wolf", presetId: "verifier" }]}
        chatSlot={chatSlot}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /fine-tune/i }));
    const args = chatSlot.mock.calls.at(-1)?.[0];
    if (!args) throw new Error("the chat was not rendered");
    check(args.thread);
  });
});

interface ChatThread {
  storageId: string;
  serverThreadKey?: string;
}
