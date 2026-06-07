import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import AdminClient from './AdminClient'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tjdrb8423@gmail.com'

export default async function AdminPage() {
  const session = await auth()
  const email = (session?.user as any)?.email

  if (email !== ADMIN_EMAIL) {
    redirect('/')
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <a href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 홈</a>
            <span className="text-gray-300">|</span>
            <h1 className="font-bold text-gray-900">관리자 — 신고 처리</h1>
          </div>
        </div>
      </header>
      <AdminClient />
    </main>
  )
}
