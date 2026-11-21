// Loaded only by the CLI subprocess test. Fail on unexpected destinations,
// headers or protocol ordering so the advertised command exercises the caller.
import assert from 'node:assert/strict'

let step = 0
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://search.parallel.ai/mcp')
  assert.equal(options.headers['User-Agent'],
    'scoop-alert/0.1.0 (+https://github.com/justinkuzmanich/scoop-alert)')
  assert.equal(options.headers.Authorization, undefined)
  assert.equal(options.headers.Cookie, undefined)
  const request = JSON.parse(options.body)
  assert.equal(request.method, ['initialize', 'notifications/initialized', 'tools/call'][step++])
  if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
  const result = request.method === 'initialize'
    ? { protocolVersion: '2025-03-26' }
    : { structuredContent: { results: [{
      title: 'Fixture offer', url: 'https://example.com/offer',
      excerpts: ['Example only: buy two, valid through the stated date.'],
    }] } }
  return Response.json({ jsonrpc: '2.0', id: request.id, result })
}
process.on('exit', () => assert.equal(step, 3))
