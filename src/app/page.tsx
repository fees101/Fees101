import { redirect } from 'next/navigation'

// Marketing lives at fees101.com — this app's root is just the entry point.
// middleware.ts already bounces an authenticated visitor off '/login' (an
// auth path) straight to '/today', so redirecting here unconditionally
// reuses that logic instead of duplicating an auth check.
export default function Home() {
  redirect('/login')
}