import { redirect } from 'next/navigation'
import { getPlatformAdmin } from '@/lib/auth'

export default async function Home() {
  const admin = await getPlatformAdmin()
  redirect(admin ? '/schools' : '/login')
}
