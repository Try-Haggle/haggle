import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlMode } from "@/lib/control-mode";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
}));

vi.mock("@/lib/control-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/control-mode")>();
  return {
    ...actual,
    patchSessionControlMode: (sessionId: string, mode: ControlMode) => mocks.patch(sessionId, mode),
  };
});

import { useSessionControlMode } from "./use-session-control-mode";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const serverAuto = {
  buyer_control_mode: "auto" as const,
  seller_control_mode: "auto" as const,
};

beforeEach(() => {
  mocks.patch.mockReset();
});

describe("useSessionControlMode pending latch", () => {
  it("keeps pendingTarget manual from queue flush until the PATCH resolves", async () => {
    const pending = deferred<{ ok: true; data: { buyer_control_mode: "manual" } }>();
    mocks.patch.mockReturnValue(pending.promise);
    const seen: Array<ControlMode | null> = [];
    let watch = false;

    const { result, rerender } = renderHook(
      (props: { localInflight: boolean }) => {
        const value = useSessionControlMode({
          sessionId: "sess-1",
          party: "buyer",
          serverSession: serverAuto,
          localInflight: props.localInflight,
        });
        if (watch) seen.push(value.pendingTarget);
        return value;
      },
      { initialProps: { localInflight: true } },
    );

    act(() => {
      result.current.requestMode("manual");
    });
    expect(result.current.pendingTarget).toBe("manual");
    expect(mocks.patch).not.toHaveBeenCalled();

    watch = true;
    await act(async () => {
      rerender({ localInflight: false });
    });

    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith("sess-1", "manual");
    expect(result.current.pendingTarget).toBe("manual");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === "manual")).toBe(true);
    expect(result.current.isManual).toBe(false);

    await act(async () => {
      pending.resolve({ ok: true, data: { buyer_control_mode: "manual" } });
      await pending.promise;
    });

    expect(result.current.isManual).toBe(true);
    expect(result.current.failedTarget).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("clears applying state and records the failure when the PATCH rejects", async () => {
    const pending = deferred<never>();
    mocks.patch.mockReturnValue(pending.promise);

    const { result, rerender } = renderHook(
      (props: { localInflight: boolean }) =>
        useSessionControlMode({
          sessionId: "sess-1",
          party: "buyer",
          serverSession: serverAuto,
          localInflight: props.localInflight,
        }),
      { initialProps: { localInflight: true } },
    );

    act(() => {
      result.current.requestMode("manual");
    });
    await act(async () => {
      rerender({ localInflight: false });
    });
    expect(result.current.pendingTarget).toBe("manual");

    await act(async () => {
      pending.reject(new Error("patch failed"));
      await Promise.resolve();
    });

    expect(result.current.pendingTarget).toBeNull();
    expect(result.current.pendingTarget).not.toBe("auto");
    expect(result.current.error).toBe("patch failed");
    expect(result.current.failedTarget).toBe("manual");
    expect(result.current.manualSwitchFailed).toBe(true);
    expect(result.current.isManual).toBe(false);

    act(() => {
      result.current.requestMode("auto");
    });
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(result.current.pendingTarget).not.toBe("auto");
    expect(result.current.manualSwitchFailed).toBe(true);
  });

  it("does not PATCH when the displayed mode already matches and nothing is pending", () => {
    mocks.patch.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() =>
      useSessionControlMode({
        sessionId: "sess-1",
        party: "buyer",
        serverSession: serverAuto,
        localInflight: false,
      }),
    );

    act(() => {
      result.current.requestMode("auto");
    });
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(result.current.pendingTarget).toBeNull();
  });

  it("re-sends the failed mode from retry without turning pendingTarget into auto", async () => {
    mocks.patch.mockRejectedValueOnce(new Error("patch failed"));
    const { result } = renderHook(() =>
      useSessionControlMode({
        sessionId: "sess-1",
        party: "buyer",
        serverSession: serverAuto,
        localInflight: false,
      }),
    );

    await act(async () => {
      result.current.requestMode("manual");
      await Promise.resolve();
    });
    expect(result.current.manualSwitchFailed).toBe(true);
    expect(result.current.pendingTarget).not.toBe("auto");

    const again = deferred<{ ok: true; data: Record<string, never> }>();
    mocks.patch.mockReturnValueOnce(again.promise);
    act(() => {
      result.current.retry();
    });
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(result.current.pendingTarget).toBe("manual");
    expect(result.current.pendingTarget).not.toBe("auto");
  });
});
