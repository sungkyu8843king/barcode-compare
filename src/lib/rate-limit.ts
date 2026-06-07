import sql from './db'
import { redis } from './redis'

export type UserTier = 'guest' | 'free' | 'donor'

export const DAILY_LIMITS: Record<UserTier, number> = {
  guest: 100,
  free: 200,
  donor: 1000,
}

// 비회원은 IP 기반 Redis 카운터
export async function checkGuestLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `guest_limit:${ip}:${new Date().toISOString().slice(0, 10)}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 86400) // 24시간 TTL

  const limit = DAILY_LIMITS.guest
  const remaining = Math.max(0, limit - count)
  return { allowed: count <= limit, remaining }
}

// 회원은 DB 카운터
export async function checkUserLimit(email: string): Promise<{ allowed: boolean; remaining: number; tier: UserTier }> {
  const today = new Date().toISOString().slice(0, 10)

  // 날짜 바뀌면 카운트 리셋
  await sql`
    UPDATE users SET
      daily_count = CASE WHEN last_search_date = ${today}::date THEN daily_count + 1 ELSE 1 END,
      last_search_date = ${today}::date
    WHERE email = ${email}
  `

  const rows = await sql`SELECT tier, daily_count FROM users WHERE email = ${email}`
  const user = rows[0]
  if (!user) return { allowed: false, remaining: 0, tier: 'guest' }

  const tier = user.tier as UserTier
  const limit = DAILY_LIMITS[tier]
  const count = user.daily_count as number
  const remaining = Math.max(0, limit - count)

  return { allowed: count <= limit, remaining, tier }
}
