import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '~/lib/api'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submitLocal(e: React.FormEvent) {
    e.preventDefault()
    const res = await api.localLogin(username, password)
    if (res.ok) window.location.href = '/'
    else setError('Invalid credentials')
  }

  return (
    <main className="login">
      <h1>📎 Clippy Chat</h1>
      <a className="btn-sso" href="/api/auth/login">Sign in with Keycloak</a>
      <form onSubmit={submitLocal}>
        <h2>Admin login</h2>
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  )
}
