import { afterEach, describe, expect, it, vi } from "vitest";
import { runDisputeModuleWebhookOutbox } from "../jobs/dispute-module-webhook-outbox.js";
import { dispatchDueDisputeModuleWebhookOutbox } from "../services/dispute-module-webhook.service.js";
import { sendDisputeModuleWebhookDeadLetterAlert } from "../services/dispute-module-webhook-alert.service.js";

vi.mock("../services/dispute-module-webhook.service.js", () => ({
  dispatchDueDisputeModuleWebhookOutbox: vi.fn(),
}));

vi.mock("../services/dispute-module-webhook-alert.service.js", () => ({
  sendDisputeModuleWebhookDeadLetterAlert: vi.fn(),
}));

describe("dispute module webhook outbox job", () => {
  afterEach(() => {
    vi.mocked(dispatchDueDisputeModuleWebhookOutbox).mockReset();
    vi.mocked(sendDisputeModuleWebhookDeadLetterAlert).mockReset();
  });

  it("sends an ops alert when a batch creates dead-letter rows", async () => {
    const result = {
      claimed: 1,
      delivered: 0,
      failed: 1,
      skipped: 0,
      deadLettered: 1,
      deadLetterEvents: [
        {
          eventId: "evt_dead",
          platformId: "platform_1",
          disputeId: "11111111-1111-5111-9111-111111111111",
          attemptCount: 10,
        },
      ],
    };
    vi.mocked(dispatchDueDisputeModuleWebhookOutbox).mockResolvedValueOnce(result);
    vi.mocked(sendDisputeModuleWebhookDeadLetterAlert).mockResolvedValueOnce({ status: "delivered" });

    await runDisputeModuleWebhookOutbox({} as never);

    expect(sendDisputeModuleWebhookDeadLetterAlert).toHaveBeenCalledWith(result);
  });

  it("does not send an ops alert when no rows dead-lettered", async () => {
    vi.mocked(dispatchDueDisputeModuleWebhookOutbox).mockResolvedValueOnce({
      claimed: 1,
      delivered: 1,
      failed: 0,
      skipped: 0,
      deadLettered: 0,
      deadLetterEvents: [],
    });

    await runDisputeModuleWebhookOutbox({} as never);

    expect(sendDisputeModuleWebhookDeadLetterAlert).not.toHaveBeenCalled();
  });

  it("does not fail the outbox job when the ops alert is misconfigured", async () => {
    vi.mocked(dispatchDueDisputeModuleWebhookOutbox).mockResolvedValueOnce({
      claimed: 1,
      delivered: 0,
      failed: 1,
      skipped: 0,
      deadLettered: 1,
      deadLetterEvents: [
        {
          eventId: "evt_dead",
          platformId: "platform_1",
          disputeId: "11111111-1111-5111-9111-111111111111",
          attemptCount: 10,
        },
      ],
    });
    vi.mocked(sendDisputeModuleWebhookDeadLetterAlert).mockRejectedValueOnce(new Error("invalid alert config"));

    await expect(runDisputeModuleWebhookOutbox({} as never)).resolves.toBeUndefined();
  });
});
