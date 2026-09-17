import { describe, expect, it, vi } from "vitest";
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  IdempotentOperation,
  requestHash,
  type IdempotencyClaim,
  type IdempotencyRepository,
  type IdempotencyRequest,
  type StoredIdempotencyResponse,
} from "../src/persistence/idempotency.js";

const request: IdempotencyRequest = {
  userId: "user-1",
  idempotencyKey: "request-1",
  requestHash: "a".repeat(64),
  expiresAt: new Date("2026-12-01T00:00:00.000Z"),
};

class FakeIdempotencyRepository implements IdempotencyRepository {
  claimResult: IdempotencyClaim = { state: "started", operationId: "op-1" };
  completed: StoredIdempotencyResponse | undefined;
  failed: StoredIdempotencyResponse | undefined;

  async claim(): Promise<IdempotencyClaim> { return this.claimResult; }
  async complete(_request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void> { this.completed = response; }
  async fail(_request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void> { this.failed = response; }
}

describe("IdempotentOperation", () => {
  it("executes once, stores the response, and replays an existing response", async () => {
    const repository = new FakeIdempotencyRepository();
    const coordinator = new IdempotentOperation(repository);
    const operation = vi.fn().mockResolvedValue({ status: 202, body: { analysisId: "analysis-1" } });

    await expect(coordinator.execute(request, operation)).resolves.toMatchObject({ replayed: false, response: { status: 202 } });
    expect(repository.completed).toEqual({ responseStatus: 202, responseBody: { analysisId: "analysis-1" } });

    repository.claimResult = { state: "replay", operationId: "op-1", response: { responseStatus: 202, responseBody: { analysisId: "analysis-1" } } };
    await expect(coordinator.execute(request, operation)).resolves.toMatchObject({ replayed: true, response: { responseStatus: 202 } });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rejects a reused key with a different request and blocks concurrent work", async () => {
    const repository = new FakeIdempotencyRepository();
    const coordinator = new IdempotentOperation(repository);
    const operation = vi.fn();

    repository.claimResult = { state: "conflict", operationId: "op-1" };
    await expect(coordinator.execute(request, operation)).rejects.toBeInstanceOf(IdempotencyConflictError);
    repository.claimResult = { state: "in_progress", operationId: "op-1" };
    await expect(coordinator.execute(request, operation)).rejects.toBeInstanceOf(IdempotencyInProgressError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("records a generic failure instead of persisting an exception message", async () => {
    const repository = new FakeIdempotencyRepository();
    const coordinator = new IdempotentOperation(repository);
    await expect(coordinator.execute(request, async () => { throw new Error("provider secret: do not persist"); })).rejects.toThrow("provider secret");
    expect(repository.failed).toEqual({ responseStatus: 500, responseBody: { error: "operation_failed" } });
  });

  it("hashes equivalent request objects deterministically", () => {
    expect(requestHash({ url: "https://vt.tiktok.com/x", options: { model: "a" } }))
      .toBe(requestHash({ options: { model: "a" }, url: "https://vt.tiktok.com/x" }));
    expect(requestHash({ url: "https://vt.tiktok.com/x" }))
      .not.toBe(requestHash({ url: "https://vt.tiktok.com/y" }));
  });
});
