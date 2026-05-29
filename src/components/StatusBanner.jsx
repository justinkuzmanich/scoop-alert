export default function StatusBanner({ saleBrands }) {
  const on = saleBrands.length > 0
  return (
    <div className={`banner ${on ? 'on' : 'off'}`}>
      <span className="big">{on ? '🎉' : '😴'}</span>
      <div>
        {on ? (
          <>
            <h2>Ice cream is ON SALE!</h2>
            <div className="sub">
              {saleBrands.map((b) => b.name).join(' & ')} —{' '}
              {saleBrands.length > 1 ? 'both your brands are' : 'is'} discounted
              right now.
            </div>
          </>
        ) : (
          <>
            <h2>No scoops on sale right now</h2>
            <div className="sub">
              We'll keep watching Häagen-Dazs and Ben &amp; Jerry's for you.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
