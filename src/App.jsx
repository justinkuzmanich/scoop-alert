import { useEffect, useMemo, useState } from 'react'
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

  useEffect(() => {
    loadDeals()
      .then((d) => {
        setData(d)
        setStoreId(d.stores?.[0]?.id ?? null)
      })
      .catch((e) => setError(e.message))
  }, [])

  const stores = data?.stores || []
  const store = useMemo(
    () => stores.find((s) => s.id === storeId) || stores[0],
    [stores, storeId]
  )
  const deals = store?.deals || []
  const saleBrands = onSaleBrands(deals)

  return (
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
            <span>
              {data.isSample && <span className="pill-sample">SAMPLE DATA</span>}{' '}
              {data.checkedAt && <>Last checked {fmtDateTime(data.checkedAt)}</>}
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
  )
}
