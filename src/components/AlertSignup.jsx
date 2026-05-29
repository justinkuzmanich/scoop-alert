import { useState } from 'react'

// Frontend-only signup. It stores the email locally for now; wiring it to a
// real backend / mailing list happens when the email provider is chosen.
// See README "Email alerts" for how the scraper sends the actual notifications.
export default function AlertSignup() {
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState(false)

  function submit(e) {
    e.preventDefault()
    if (!email) return
    try {
      const list = JSON.parse(localStorage.getItem('scoop-subscribers') || '[]')
      if (!list.includes(email)) list.push(email)
      localStorage.setItem('scoop-subscribers', JSON.stringify(list))
    } catch {
      /* ignore storage errors */
    }
    setSaved(true)
  }

  return (
    <section className="signup">
      <h2>🔔 Get an email when it's on sale</h2>
      <p>
        We check the Mill Valley Safeway daily. The moment Häagen-Dazs or Ben
        &amp; Jerry's drops to a member price, you'll get a heads-up.
      </p>
      {saved ? (
        <div className="ok-msg">
          🍦 You're on the list! We'll ping {email} when the deals hit.
        </div>
      ) : (
        <form onSubmit={submit}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn" type="submit">
            Alert me
          </button>
        </form>
      )}
      <div className="note">
        Heads up: this saves your address in the browser for now. Hook up a mail
        provider (Resend, etc.) in the scraper to send real emails — see the
        README.
      </div>
    </section>
  )
}
