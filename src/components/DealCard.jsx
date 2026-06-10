import { fmtPrice, fmtDate } from '../lib/deals.js'

export default function DealCard({ deal }) {
  const onSale = Boolean(deal.onSale)
  const showWas = deal.regularPrice > deal.price
  return (
    <div className={`card ${onSale ? 'sale' : ''}`}>
      {onSale && <span className="badge-sale">ON SALE</span>}
      {deal.image && (
        <div className="thumb">
          <img
            src={deal.image}
            alt={deal.name}
            loading="lazy"
            // If the image 404s, hide it so the card falls back cleanly.
            onError={(e) => {
              e.currentTarget.parentElement.style.display = 'none'
            }}
          />
        </div>
      )}
      <div className="name">{deal.name}</div>
      <div className="price-row">
        <span className="price">{fmtPrice(deal.price)}</span>
        {showWas && <span className="was">{fmtPrice(deal.regularPrice)}</span>}
      </div>
      {deal.dealText && <div className="deal-text">{deal.dealText}</div>}
      {onSale && deal.validTo && (
        <div className="valid">Through {fmtDate(deal.validTo)}</div>
      )}
    </div>
  )
}
