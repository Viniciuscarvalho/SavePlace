import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

export const BROWSER_SESSION_COOKIE = "saveplace_session";
export const BROWSER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const BrowserSessionTokenSchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);

export type BrowserSessionRecord = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export interface BrowserSessionRepository {
  findSessionUserId(tokenHash: string, now: Date): Promise<string | undefined>;
  createSession(session: BrowserSessionRecord): Promise<void>;
}

export type ResolvedBrowserSession = {
  userId: string;
  /** Set only when an absent, expired or invalid cookie needs replacement. */
  setCookie?: string;
};

export type BrowserSessionServiceOptions = {
  now?: () => Date;
  tokenFactory?: () => string;
  userIdFactory?: () => string;
  ttlMs?: number;
};

/**
 * Owns the browser-to-user boundary. Raw bearer tokens never reach the
 * database: the repository receives a SHA-256 digest only.
 */
export class BrowserSessionService {
  private readonly now: () => Date;
  private readonly tokenFactory: () => string;
  private readonly userIdFactory: () => string;
  private readonly ttlMs: number;

  constructor(private readonly repository: BrowserSessionRepository, options: BrowserSessionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.userIdFactory = options.userIdFactory ?? randomUUID;
    this.ttlMs = options.ttlMs ?? BROWSER_SESSION_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new Error("Browser session TTL must be a positive integer.");
  }

  async resolve(cookieHeader: string | undefined): Promise<ResolvedBrowserSession> {
    const token = BrowserSessionTokenSchema.safeParse(readCookie(cookieHeader, BROWSER_SESSION_COOKIE));
    if (token.success) {
      const userId = await this.repository.findSessionUserId(hashSessionToken(token.data), this.now());
      if (userId) return { userId };
    }

    const userId = this.userIdFactory();
    const rawToken = BrowserSessionTokenSchema.parse(this.tokenFactory());
    if (!userId.trim() || userId.length > 128) throw new Error("Browser session user id must be 1-128 characters.");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    await this.repository.createSession({ userId, tokenHash: hashSessionToken(rawToken), expiresAt });
    return {
      userId,
      setCookie: serializeSessionCookie(rawToken, Math.floor(this.ttlMs / 1_000)),
    };
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

export function serializeSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${BROWSER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
