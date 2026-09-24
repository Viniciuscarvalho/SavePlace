import { createHash } from "node:crypto";

export type IdempotencyRequest = {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: Date;
};

export type StoredIdempotencyResponse = {
  responseStatus: number;
  responseBody: Record<string, unknown>;
};

export type IdempotencyClaim =
  | { state: "started"; operationId: string }
  | { state: "replay"; operationId: string; response: StoredIdempotencyResponse }
  | { state: "in_progress"; operationId: string }
  | { state: "conflict"; operationId: string };

export interface IdempotencyRepository {
  claim(request: IdempotencyRequest): Promise<IdempotencyClaim>;
  complete(request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void>;
  fail(request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("An idempotency key cannot be reused for a different request.");
  }
}

export class IdempotencyInProgressError extends Error {
  constructor() {
    super("An identical request is already processing.");
  }
}

/** A deliberate client-safe failure that must replay without repeating work. */
export class IdempotencyResponseError extends Error {
  constructor(public readonly response: StoredIdempotencyResponse) {
    super(String(response.responseBody.error ?? "operation_failed"));
  }
}

export type IdempotentExecution<T extends Record<string, unknown>> =
  | { replayed: false; response: { status: number; body: T } }
  | { replayed: true; response: StoredIdempotencyResponse };

/** Stores a safe failure response so retries cannot accidentally repeat paid work. */
export class IdempotentOperation {
  constructor(private readonly repository: IdempotencyRepository) {}

  async execute<T extends Record<string, unknown>>(
    request: IdempotencyRequest,
    operation: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentExecution<T>> {
    const claim = await this.repository.claim(request);
    if (claim.state === "replay") return { replayed: true, response: claim.response };
    if (claim.state === "conflict") throw new IdempotencyConflictError();
    if (claim.state === "in_progress") throw new IdempotencyInProgressError();

    try {
      const response = await operation();
      await this.repository.complete(request, { responseStatus: response.status, responseBody: response.body });
      return { replayed: false, response };
    } catch (error) {
      await this.repository.fail(request, error instanceof IdempotencyResponseError
        ? error.response
        : { responseStatus: 500, responseBody: { error: "operation_failed" } });
      throw error;
    }
  }
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableJsonValue(value))).digest("hex");
}

function stableJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .filter((key) => object[key] !== undefined)
        .map((key) => [key, stableJsonValue(object[key])]),
    );
  }
  throw new TypeError("Idempotency request data must be JSON-serializable.");
}
