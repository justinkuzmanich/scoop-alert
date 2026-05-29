import DealCard from './DealCard.jsx'

export default function BrandSection({ brand, deals }) {
  const saleCount = deals.filter((d) => d.onSale).length
  return (
    <section className="brand">
      <div className="brand-head">
        <span className="emoji" style={{ color: brand.color }}>
          {brand.emoji}
        </span>
        <h2 style={{ color: brand.color }}>{brand.name}</h2>
        <span className={`count ${saleCount ? '' : 'zero'}`}>
          {saleCount ? `${saleCount} on sale` : 'no deals'}
        </span>
      </div>
      {deals.length === 0 ? (
        <div className="empty">
          No {brand.name} products found at this store yet.
        </div>
      ) : (
        <div className="cards">
          {deals.map((d) => (
            <DealCard key={d.id} deal={d} />
          ))}
        </div>
      )}
    </section>
  )
}
