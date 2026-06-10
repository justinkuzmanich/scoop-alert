// Safeway "for U" member-deal capture snippet.
//
// HOW TO USE (this runs in YOUR browser, not Node):
//   1. In your normal Chrome, sign in to https://www.safeway.com and set your
//      Mill Valley store.
//   2. Open DevTools (F12) → Console.
//   3. Copy EVERYTHING in this file and paste it into the console, press Enter.
//   4. In Safeway's search box, search "Haagen-Dazs", then "Ben & Jerry's".
//      Each captured search logs: ✅ captured N
//   5. Run  __j4uSave()  in the console → downloads j4u-capture.json
//   6. Import it:  npm run j4u:import  ~/Downloads/j4u-capture.json
//
// Nothing is sent anywhere — it only listens to the product-search responses
// your own browser already makes, and saves them to a local file.

(() => {
  const cap = (window.__j4u = window.__j4u || { capturedAt: null, responses: [] })
  const isHit = (u) => typeof u === 'string' && u.includes('/pgmsearch/')
  const add = (url, json) => {
    cap.responses.push({ url, json })
    cap.capturedAt = new Date().toISOString()
    console.log('✅ captured', cap.responses.length, '—', url.split('?')[0])
  }

  // Intercept fetch()
  const origFetch = window.fetch
  window.fetch = async (...args) => {
    const res = await origFetch(...args)
    try {
      const url = (args[0] && args[0].url) || args[0]
      if (isHit(url)) add(url, await res.clone().json())
    } catch {}
    return res
  }

  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__j4uUrl = url
    return origOpen.call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.send = function (...rest) {
    this.addEventListener('load', () => {
      try {
        if (isHit(this.__j4uUrl)) add(this.__j4uUrl, JSON.parse(this.responseText))
      } catch {}
    })
    return origSend.apply(this, rest)
  }

  // Download what we've captured.
  window.__j4uSave = () => {
    if (!cap.responses.length) {
      console.warn('⚠️ Nothing captured yet — do a search first.')
      return
    }
    const blob = new Blob([JSON.stringify(cap, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'j4u-capture.json'
    a.click()
    console.log('💾 Saved j4u-capture.json with', cap.responses.length, 'response(s).')
  }

  console.log(
    '🎣 J4U capture armed. Now search "Haagen-Dazs" then "Ben & Jerry\'s" in the ' +
      'Safeway search box. When the console shows ✅ for each, run __j4uSave()'
  )
})()
