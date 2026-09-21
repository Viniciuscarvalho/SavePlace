import { describe, expect, it } from "vitest";
import {
  BROWSER_SESSION_COOKIE,
  BrowserSessionService,
  hashSessionToken,
  type BrowserSessionRecord,
  type BrowserSessionRepository,
} from "../src/application/browser-session-service.js";

class MemorySessionRepository implements BrowserSessionRepository {
  readonly sessions = new Map<string, BrowserSessionRecord>();

  async findSessionUserId(tokenHash: string, now: Date): Promise<string | undefined> {
    const session = this.sessions.get(tokenHash);
    return session && session.expiresAt > now ? session.userId : undefined;
  }

  async createSession(session: BrowserSessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, session);
  }
}

describe("BrowserSessionService", () => {
  it("creates an opaque secure cookie and persists only its hash", async () => {
    const repository = new MemorySessionRepository();
    const token = "a".repeat(43);
    const service = new BrowserSessionService(repository, {
      now: () => new Date("2026-09-21T12:00:00.000Z"),
      tokenFactory: () => token,
      userIdFactory: () => "user-a",
    });

    const session = await service.resolve(undefined);

    expect(session).toEqual({
      userId: "user-a",
      setCookie: `${BROWSER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    });
    expect(repository.sessions.get(hashSessionToken(token))).toMatchObject({ userId: "user-a" });
    expect([...repository.sessions.values()].map((value) => value.tokenHash)).not.toContain(token);
  });

  it("resolves the same browser and isolates a different browser", async () => {
    const repository = new MemorySessionRepository();
    const tokens = ["a".repeat(43), "b".repeat(43)];
    const userIds = ["user-a", "user-b"];
    const service = new BrowserSessionService(repository, {
      tokenFactory: () => tokens.shift()!,
      userIdFactory: () => userIds.shift()!,
    });

    const firstBrowser = await service.resolve(undefined);
    const sameBrowser = await service.resolve(firstBrowser.setCookie);
    const secondBrowser = await service.resolve(undefined);

    expect(sameBrowser).toEqual({ userId: firstBrowser.userId });
    expect(secondBrowser.userId).not.toBe(firstBrowser.userId);
    expect(repository.sessions).toHaveLength(2);
  });

  it("replaces an expired cookie with a new browser identity", async () => {
    const repository = new MemorySessionRepository();
    const expiredToken = "e".repeat(43);
    const replacementToken = "r".repeat(43);
    repository.sessions.set(hashSessionToken(expiredToken), {
      userId: "expired-user",
      tokenHash: hashSessionToken(expiredToken),
      expiresAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    const service = new BrowserSessionService(repository, {
      now: () => new Date("2026-09-21T00:00:00.000Z"),
      tokenFactory: () => replacementToken,
      userIdFactory: () => "replacement-user",
    });

    await expect(service.resolve(`${BROWSER_SESSION_COOKIE}=${expiredToken}`)).resolves.toMatchObject({
      userId: "replacement-user",
      setCookie: expect.stringContaining(replacementToken),
    });
  });
});
