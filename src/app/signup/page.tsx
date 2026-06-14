'use client'

import { useState } from 'react'
import { signup } from './actions'

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await signup(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-5">
      <div className="bg-white p-10 rounded-xl border border-gray-200 w-full max-w-md">
        <h1 className="text-navy text-3xl font-bold mb-2">Get started</h1>
        <p className="text-gray-500 text-sm mb-8">Create your Fees101 account</p>

        <form action={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm text-gray-700 font-medium">
            Full name
            <input 
              type="text" 
              name="name" 
              required 
              placeholder="Your name"
              className="px-3.5 py-3 border border-gray-300 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-gray-700 font-medium">
            Email
            <input 
              type="email" 
              name="email" 
              required 
              placeholder="you@school.edu.ng"
              className="px-3.5 py-3 border border-gray-300 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-gray-700 font-medium">
            Password
            <input 
              type="password" 
              name="password" 
              required 
              minLength={8}
              placeholder="At least 8 characters"
              className="px-3.5 py-3 border border-gray-300 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
            />
          </label>

          {error && (
            <p className="text-red-700 text-xs px-3 py-2 bg-red-50 rounded-md">
              {error}
            </p>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="bg-mint text-navy py-3 rounded-lg text-sm font-semibold hover:bg-mint/90 disabled:opacity-50 mt-2"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account? <a href="/login" className="text-mint font-medium hover:underline">Sign in</a>
        </p>
      </div>
    </main>
  )
}