import { useCallback, useEffect, useMemo, useState } from 'react'
import { BRANDS } from './data/config.js'
import {
  loadDeals,
  dealsForBrand,
  onSaleBrands,
  fmtDateTime,
} from './lib/deals.js'
import StatusBanner from './components/StatusBanner.jsx'
import BrandSection from './components/BrandSection.jsx'
import AlertSignup from './components/AlertSignup.jsx'

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [storeId, setStoreId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [theme, setTheme] = useState(
    () => localStorage.getItem('scoop-theme') || 'dark'
  )

  // Apply + persist the colour theme on <html> so CSS variables can switch.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('scoop-theme', theme)
  }, [theme])

  // Re-fetches the latest published deals.json. The browser can't run the
  // scraper (no backend; Flipp is bot-walled + CORS), so "checking" means
  // pulling the freshest file the daily workflow has committed. `bust` skips
  // any CDN cache on an explicit user click.
  const refresh = useCallback(({ bust = false } = {}) => {
    setRefreshing(true)
    setError(null)
    return loadDeals({ bust })
      .then((d) => {
        setData(d)
        // Keep the user's current store selection across a manual refresh.
        setStoreId((prev) => prev ?? d.stores?.[0]?.id ?? null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const stores = data?.stores || []
  const store = useMemo(
    () => stores.find((s) => s.id === storeId) || stores[0],
    [stores, storeId]
  )
  const deals = store?.deals || []
  const saleBrands = onSaleBrands(deals)

  // Decorative floating scoops behind everything (purely cosmetic).
  const scoops = ['🍦', '🍨', '🍧', '🍒', '🍓', '🍫', '🍦', '🍨', '🥄', '🍧']

  return (
    <>
      <div className="scoops" aria-hidden="true">
        {scoops.map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
      <div className="wrap">
      <header className="hero">
        <div className="logo">🍦</div>
        <h1>Scoop Alert</h1>
        <p className="tag">
          Tracking Häagen-Dazs &amp; Ben &amp; Jerry's deals at Safeway in Mill Valley
        </p>
      </header>

      {error && (
        <div className="banner off">
          <span className="big">⚠️</span>
          <div>
            <h2>Couldn't load deals</h2>
            <div className="sub">{error}</div>
          </div>
        </div>
      )}

      {store && (
        <>
          <StatusBanner saleBrands={saleBrands} />

          <div className="meta">
            <label>
              📍{' '}
              <select
                value={store.id}
                onChange={(e) => setStoreId(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="meta-right">
              {data.isSample && <span className="pill-sample">SAMPLE DATA</span>}
              {data.checkedAt && <>Last checked {fmtDateTime(data.checkedAt)}</>}
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                aria-label="Toggle colour theme"
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => refresh({ bust: true })}
                disabled={refreshing}
                title="Re-fetch the latest published deals"
              >
                {refreshing ? 'Checking…' : '🍦 Check deals'}
              </button>
            </span>
          </div>

          {BRANDS.map((brand) => (
            <BrandSection
              key={brand.id}
              brand={brand}
              deals={dealsForBrand(deals, brand.id)}
            />
          ))}

          <AlertSignup />
        </>
      )}

      {!store && !error && (
        <div className="empty" style={{ marginTop: 40 }}>
          Scooping up the latest deals… 🍨
        </div>
      )}

      <footer>
        Made with 🍨 for Marin · Prices from Safeway, not affiliated with Safeway
      </footer>
      </div>
    </>
  )
}
