// artifacts/api-server/src/watbot/limits.ts
import { and, eq, gte, min, sql } from "drizzle-orm";
import { db as defaultDb, watbotMessagesTable } from "@workspace/db";
import { parsePositiveIntEnv } from "../solver/jobRunner.js";

type Db = typeof defaultDb;
export const STUDENT_DAILY_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNAVAILABLE_MS = 60_000;
// FR-35 / D22: a question counts only when it reached the model. Positive match on
// purpose: a status added later is uncounted until someone decides otherwise.
export const COUNTED_STATUS = "answered" as const;

export async function studentUsage(userId: string, now = new Date(), database: Db = defaultDb) {
  const since = new Date(now.getTime() - DAY_MS);
  const [row] = await database.select({ used: sql<number>`count(*)::int`, first: min(watbotMessagesTable.createdAt) })
    .from(watbotMessagesTable)
    .where(and(
      eq(watbotMessagesTable.userId, userId), eq(watbotMessagesTable.role, "student"),
      eq(watbotMessagesTable.status, COUNTED_STATUS), gte(watbotMessagesTable.createdAt, since),
    ));
  const used = row?.used ?? 0;
  const first = row?.first ?? null;
  return {
    used,
    remaining: Math.max(0, STUDENT_DAILY_LIMIT - used),
    resetAt: used && first ? new Date(first.getTime() + DAY_MS) : null,
  };
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function monthlySpendUsd(now = new Date(), database: Db = defaultDb): Promise<number> {
  const [row] = await database.select({ total: sql<string>`coalesce(sum((${watbotMessagesTable.usage}->>'costUsd')::numeric), 0)` })
    .from(watbotMessagesTable)
    .where(and(eq(watbotMessagesTable.role, "tutor"), gte(watbotMessagesTable.createdAt, monthStart(now))));
  return Number(row?.total ?? 0);
}

export function monthlyCapUsd(): number {
  const v = Number(process.env.WATBOT_MONTHLY_USD);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

// ponytail: in-process flags, queue, per-user locks and spend reservations assume a
// single nos-api instance; move to Postgres advisory locks if the API is scaled out.
let unavailableUntil = 0;
let capMonth: string | null = null;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
export function markUnavailable(now = new Date()) { unavailableUntil = now.getTime() + UNAVAILABLE_MS; }
export function markAvailable() { unavailableUntil = 0; }
export function isAvailable(now = new Date()) { return now.getTime() >= unavailableUntil; }
export function markProjectCapReached(now = new Date()) { capMonth = monthKey(now); }
export function projectCapFlagged(now = new Date()) { return capMonth === monthKey(now); }

// D21 — one question in flight per user. The route holds this across the 24 h
// count, the spend reservation, the student-row insert and the whole answer.
const busyUsers = new Set<string>();
export function tryLockUser(userId: string): (() => void) | null {
  if (busyUsers.has(userId)) return null;
  busyUsers.add(userId);
  let held = true;
  return () => { if (held) { held = false; busyUsers.delete(userId); } };
}
export const isUserLocked = (userId: string) => busyUsers.has(userId);

// D21 — worst-case reservations for admitted, unfinished questions.
const reservations = new Map<number, number>();
let nextReservation = 1;
export function reservedUsd(): number {
  let total = 0;
  for (const usd of reservations.values()) total += usd;
  return total;
}
// Synchronous on purpose: nothing can interleave between reading the
// reservations and adding this one, so two admissions cannot both fit the gap.
export function admitSpend(storedUsd: number, reservationUsd: number, cap = monthlyCapUsd()): (() => void) | null {
  if (projectCapFlagged() || storedUsd + reservedUsd() + reservationUsd >= cap) return null;
  const id = nextReservation++;
  reservations.set(id, reservationUsd);
  return () => { reservations.delete(id); };
}

type Waiter = { readyAt: number; admit: () => void };

// Strict FIFO in-flight queue. `requeue` (D24) puts a 429'd request back at the
// head with a not-before time; the head holds its place until then, so later
// arrivals never overtake it (a 429 means the API wants less traffic anyway).
export function createInflightQueue(max: number) {
  let active = 0;
  const waiting: Waiter[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pump = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    while (active < max && waiting.length) {
      const wait = waiting[0]!.readyAt - Date.now();
      if (wait > 0) { timer = setTimeout(pump, wait); return; }
      const head = waiting.shift()!;
      active++;
      head.admit();
    }
  };
  const makeRelease = () => {
    let held = true;
    return () => { if (held) { held = false; active--; pump(); } };
  };
  const enqueue = (front: boolean, readyAt: number, onQueued: (position: number) => void, signal: AbortSignal) =>
    new Promise<() => void>((resolve, reject) => {
      if (signal.aborted) { reject(new Error("aborted")); return; }
      const entry: Waiter = { readyAt, admit: () => { signal.removeEventListener("abort", onAbort); resolve(makeRelease()); } };
      const onAbort = () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(new Error("aborted"));
        pump(); // the head may have changed
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (front) waiting.unshift(entry); else waiting.push(entry);
      pump();
      const i = waiting.indexOf(entry);
      if (i >= 0) onQueued(i + 1);
    });

  return {
    acquire: (onQueued: (position: number) => void, signal: AbortSignal) => enqueue(false, 0, onQueued, signal),
    requeue: (retryAfterMs: number, onQueued: (position: number) => void, signal: AbortSignal) =>
      enqueue(true, Date.now() + retryAfterMs, onQueued, signal),
  };
}

export let inflight = createInflightQueue(parsePositiveIntEnv(process.env.WATBOT_MAX_INFLIGHT, 10));

export function resetWatBotLimitsForTests() {
  unavailableUntil = 0; capMonth = null;
  busyUsers.clear(); reservations.clear();
  inflight = createInflightQueue(parsePositiveIntEnv(process.env.WATBOT_MAX_INFLIGHT, 10));
}
