import { fmtPrice, fmtDate } from '../lib/deals.js'

export default function DealCard({ deal }) {
  const onSale = Boolean(deal.onSale)
  const showWas = deal.regularPrice > deal.price
  return (
    <div className={`card ${onSale ? 'sale' : ''}`}>
      {onSale && <span className="badge-sale">ON SALE</span>}
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
