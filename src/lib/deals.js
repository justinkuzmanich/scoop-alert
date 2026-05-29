import { BRANDS } from '../data/config.js'

// Loads the deals JSON produced by the scraper (or the bundled sample).
// `base` respects Vite's configured base path so it works on GitHub Pages.
export async function loadDeals() {
  const url = `${import.meta.env.BASE_URL}data/deals.json`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load deals (${res.status})`)
  return res.json()
}

export function brandById(id) {
  return BRANDS.find((b) => b.id === id)
}

export function dealsForBrand(deals, brandId) {
  return (deals || []).filter((d) => d.brandId === brandId)
}

export function anyOnSale(deals) {
  return (deals || []).some((d) => d.onSale)
}

export function onSaleBrands(deals) {
  const ids = new Set((deals || []).filter((d) => d.onSale).map((d) => d.brandId))
  return BRANDS.filter((b) => ids.has(b.id))
}

export function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `$${Number(n).toFixed(2)}`
}

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
