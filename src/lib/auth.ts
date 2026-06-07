import NextAuth from 'next-auth'
import Kakao from 'next-auth/providers/kakao'
import sql from './db'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Kakao({
      clientId: process.env.KAKAO_CLIENT_ID!,
      clientSecret: process.env.KAKAO_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email && account?.providerAccountId) {
        // 카카오는 이메일 없을 수 있음 → kakao_id로 대체
        user.email = `kakao_${account.providerAccountId}@kakao.local`
      }
      // users 테이블 upsert
      await sql`
        INSERT INTO users (email, name, image, provider, provider_id, tier)
        VALUES (
          ${user.email ?? `kakao_${account?.providerAccountId}@kakao.local`},
          ${user.name ?? '사용자'},
          ${user.image ?? null},
          ${account?.provider ?? 'kakao'},
          ${account?.providerAccountId ?? null},
          'free'
        )
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          image = EXCLUDED.image,
          last_login = NOW()
      `
      return true
    },
    async session({ session }) {
      // 세션에 tier 정보 추가
      if (session.user?.email) {
        const rows = await sql`
          SELECT tier, daily_count, last_search_date
          FROM users WHERE email = ${session.user.email}
        `
        if (rows[0]) {
          ;(session.user as { tier?: string; dailyCount?: number }).tier = rows[0].tier
          ;(session.user as { tier?: string; dailyCount?: number }).dailyCount = rows[0].daily_count
        }
      }
      return session
    },
  },
  pages: {
    signIn: '/',
  },
})
