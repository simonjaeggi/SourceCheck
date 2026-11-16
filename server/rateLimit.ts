/**
 * Fixed-window rate limits for /api/assess (profile "assess") and /api/lookup (profile "lookup").
 *
 * Serverless instances share no memory, so real limits need a shared store:
 * add Upstash Redis from the Vercel Marketplace (it sets KV_REST_API_URL and
 * KV_REST_API_TOKEN). Without it we fall back to per-instance memory, which
 * only limits bursts that hit the same instance, and log a warning.
 *
 * Limits are env-configurable:
 *   RATE_LIMIT_PER_MINUTE  per client IP (default 5)
 *   RATE_LIMIT_PER_DAY     per client IP (default 40)
 *   GLOBAL_LIMIT_PER_DAY   all clients together, caps daily spend (default 300)
 * Each assessment can make at most 3 model calls (1 + 2 repairs).
 *
 * Lookups (no model cost, but each reference without a DOI is one OpenAlex search):
 *   LOOKUP_LIMIT_PER_MINUTE (default 6), LOOKUP_LIMIT_PER_DAY (default 60) per client IP
 */

export type Profile = "assess" | "lookup"

type Window = { key: string; limit: number; ttlSeconds: number }
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function windowsFor(ip: string, now: number, profile: Profile): Window[] {
  const minute = Math.floor(now / 60_000)
  const day = Math.floor(now / 86_400_000)
  if (profile === "lookup")
    return [
      { key: `rl:lookup:ip:${ip}:m:${minute}`, limit: num(process.env.LOOKUP_LIMIT_PER_MINUTE, 6), ttlSeconds: 60 },
      { key: `rl:lookup:ip:${ip}:d:${day}`, limit: num(process.env.LOOKUP_LIMIT_PER_DAY, 60), ttlSeconds: 86_400 },
    ]
  return [
    { key: `rl:ip:${ip}:m:${minute}`, limit: num(process.env.RATE_LIMIT_PER_MINUTE, 5), ttlSeconds: 60 },
    { key: `rl:ip:${ip}:d:${day}`, limit: num(process.env.RATE_LIMIT_PER_DAY, 40), ttlSeconds: 86_400 },
    { key: `rl:all:d:${day}`, limit: num(process.env.GLOBAL_LIMIT_PER_DAY, 300), ttlSeconds: 86_400 },
  ]
}

function secondsUntilWindowEnds(w: Window, now: number) {
  const ms = w.ttlSeconds * 1000
  return Math.max(1, Math.ceil((ms - (now % ms)) / 1000))
}

// ── Stores ───────────────────────────────────────────────────────────────────

const memory = new Map<string, { count: number; expiresAt: number }>()

async function incrMemory(w: Window, now: number): Promise<number> {
  const hit = memory.get(w.key)
  if (!hit || hit.expiresAt <= now) {
    memory.set(w.key, { count: 1, expiresAt: now + w.ttlSeconds * 1000 })
    return 1
  }
  hit.count += 1
  return hit.count
}

async function incrRedis(url: string, token: string, w: Window): Promise<number> {
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", w.key],
      ["EXPIRE", w.key, w.ttlSeconds, "NX"],
    ]),
  })
  if (!res.ok) throw new Error(`rate limit store returned ${res.status}`)
  const out = (await res.json()) as { result?: number; error?: string }[]
  if (typeof out[0]?.result !== "number") throw new Error(`rate limit store error: ${out[0]?.error ?? "unknown"}`)
  return out[0].result
}

let warned = false

export async function checkRateLimit(ip: string, now = Date.now(), profile: Profile = "assess"): Promise<RateLimitResult> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if ((!url || !token) && !warned && process.env.VERCEL_ENV === "production") {
    warned = true
    console.warn("[rate-limit] No Redis configured; using per-instance memory. Add Upstash Redis for real limits.")
  }

  for (const w of windowsFor(ip, now, profile)) {
    // A store outage fails closed: better to refuse than to run up model costs.
    const count = url && token ? await incrRedis(url, token, w) : await incrMemory(w, now)
    if (count > w.limit) return { allowed: false, retryAfterSeconds: secondsUntilWindowEnds(w, now) }
  }
  return { allowed: true }
}
