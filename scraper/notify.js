// Pluggable email sender. Chooses a provider based on env vars; falls back to
// a console "dry-run" so the pipeline always works even before email is wired.

function buildEmail(store, newlyOnSale) {
  const lines = newlyOnSale.map((d) => {
    const price = d.price != null ? `$${d.price.toFixed(2)}` : '?'
    const was =
      d.regularPrice && d.regularPrice > d.price
        ? ` (was $${d.regularPrice.toFixed(2)})`
        : ''
    const extra = d.dealText ? ` — ${d.dealText}` : ''
    return `• ${d.name}: ${price}${was}${extra}`
  })

  const subject = `🍦 Ice cream on sale at ${store.name}!`
  const text =
    `Good news — these just went on sale at ${store.name}:\n\n` +
    lines.join('\n') +
    `\n\nGo get your scoops! 🍨`
  const html =
    `<h2>🍦 Ice cream on sale at ${store.name}!</h2>` +
    `<p>These just went on sale:</p><ul>` +
    newlyOnSale
      .map((d) => {
        const price = d.price != null ? `$${d.price.toFixed(2)}` : '?'
        const was =
          d.regularPrice && d.regularPrice > d.price
            ? ` <s style="color:#999">$${d.regularPrice.toFixed(2)}</s>`
            : ''
        const extra = d.dealText
          ? ` — <strong>${d.dealText}</strong>`
          : ''
        return `<li><strong>${d.name}</strong>: ${price}${was}${extra}</li>`
      })
      .join('') +
    `</ul><p>Go get your scoops! 🍨</p>`

  return { subject, text, html }
}

async function sendWithResend({ subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.ALERT_FROM || 'Scoop Alert <onboarding@resend.dev>',
      to: (process.env.ALERT_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
      subject,
      text,
      html,
    }),
  })
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function notify(store, newlyOnSale) {
  if (!newlyOnSale.length) return
  const email = buildEmail(store, newlyOnSale)
  const dryRun = process.env.DRY_RUN === '1'

  if (!dryRun && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
    await sendWithResend(email)
    console.log(`📧 Sent alert to ${process.env.ALERT_TO}`)
    return
  }

  // Console fallback / dry run.
  console.log('\n──────── EMAIL (not sent — console mode) ────────')
  console.log(`To:      ${process.env.ALERT_TO || '(set ALERT_TO)'}`)
  console.log(`Subject: ${email.subject}`)
  console.log(email.text)
  console.log('─────────────────────────────────────────────────\n')
}
