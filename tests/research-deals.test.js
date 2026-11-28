import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { main, researchDeals } from '../scripts/research-deals.js'
import { BRANDS, PRIMARY_STORE } from '../src/data/config.js'

const run = promisify(execFile)
const results = [{
  url: 'https://example.com/offer', title: 'Example offer',
  publish_date: '2026-05-29', excerpts: ['Buy two pints; check local availability.'],
}]

function server(tool = { structuredContent: { results } }, callResponse) {
  const calls = []
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body)
    calls.push({ url, options, request })
    if (request.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    }
    if (request.method === 'tools/call' && callResponse) return callResponse(request, options)
    return Response.json({ jsonrpc: '2.0', id: request.id, result:
      request.method === 'initialize' ? { protocolVersion: '2025-03-26' } : tool,
    }, { headers: { 'Mcp-Session-Id': 'fixture-session' } })
  }
  return { fetchImpl, calls }
}

test('default CLI dispatch returns source excerpts and preserves existing data', async () => {
  const paths = ['public/data/deals.json', 'scraper/manual-deals.json', 'scraper/run.js']
  const before = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url))))
  const { fetchImpl, calls } = server({ structuredContent: { results, warnings: [{ message: 'Example warning' }] } })
  let output
  assert.equal(await main([], { fetchImpl, stdout: (text) => { output = JSON.parse(text) } }), 0)
  assert.deepEqual(output.results, results)
  assert.equal(output.warnings[0].message, 'Example warning')
  assert.match(output.note, /Verify store/)
  assert.deepEqual(output.searchQueries, BRANDS.map((brand) =>
    `Safeway ${brand.name} sale ${PRIMARY_STORE.postalCode}`))
  assert.deepEqual(calls.map((c) => c.request.method),
    ['initialize', 'notifications/initialized', 'tools/call'])
  for (const { url, options } of calls) {
    assert.equal(url, 'https://search.parallel.ai/mcp')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers['User-Agent'],
      'scoop-alert/0.1.0 (+https://github.com/justinkuzmanich/scoop-alert)')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.headers.Cookie, undefined)
    assert.equal(options.headers.Accept, 'application/json, text/event-stream')
    assert.ok(options.signal instanceof AbortSignal)
  }
  assert.equal(calls[0].request.params.clientInfo.name, 'scoop-alert')
  for (const call of calls.slice(1)) {
    assert.equal(call.options.headers['Mcp-Session-Id'], 'fixture-session')
    assert.equal(call.options.headers['MCP-Protocol-Version'], '2025-03-26')
  }
  assert.equal(calls[1].request.id, undefined)
  const tool = calls[2].request.params
  assert.equal(tool.name, 'web_search')
  assert.match(tool.arguments.objective, new RegExp(PRIMARY_STORE.postalCode))
  assert.match(tool.arguments.objective, /manual verification/)
  assert.match(tool.arguments.session_id, /^[a-f0-9-]{36}$/)
  assert.equal(tool.arguments.model_name, undefined) // This command has no LLM caller.
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url)))), before)
})

test('custom query and JSON text output, including no matches', async () => {
  const { fetchImpl, calls } = server({ content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] })
  const output = await researchDeals('  Safeway buy two 94941  ', { fetchImpl })
  assert.deepEqual(calls[2].request.params.arguments.search_queries, ['Safeway buy two 94941'])
  assert.deepEqual(output.results, [])
})

test('SSE handles chunk boundaries, CRLF, notifications and an open connection', async () => {
  let cancelled = false
  const { fetchImpl } = server(null, (request) => {
    const message = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { structuredContent: { results } } })
    const split = message.indexOf(',') + 1
    const wire = ': keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n' +
      `event: message\r\ndata: ${message.slice(0, split)}\r\ndata: ${message.slice(split)}\r\n\r\n`
    return new Response(new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(wire)
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        // Deliberately leave open: receiving the matching message must suffice.
      },
      cancel() { cancelled = true },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  assert.deepEqual((await researchDeals('', { fetchImpl })).results, results)
  assert.equal(cancelled, true)
})

test('HTTP, JSON-RPC, tool and malformed responses fail without outputting deals', async (t) => {
  const cases = [
    ['HTTP limit', () => new Response('Too many requests', { status: 429 }), /HTTP 429/],
    ['RPC error', (r) => Response.json({ jsonrpc: '2.0', id: r.id, error: { message: 'Invalid parameters' } }), /Invalid parameters/],
    ['wrong id', () => Response.json({ jsonrpc: '2.0', id: 999, result: {} }), /Invalid MCP response/],
    ['tool error', (r) => Response.json({ jsonrpc: '2.0', id: r.id, result: { isError: true, content: [{ type: 'text', text: 'Search quota exceeded' }] } }), /Search quota exceeded/],
    ['malformed data', (r) => Response.json({ jsonrpc: '2.0', id: r.id, result: { structuredContent: { results: [{ url: 'bad', excerpts: [] }] } } }), /Unexpected Parallel/],
    ['bad JSON', () => new Response('not JSON'), /JSON/],
    ['ended SSE', () => new Response('event: message\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), /without a matching response/],
  ]
  for (const [name, response, expected] of cases) await t.test(name, async () => {
    const { fetchImpl } = server(null, response)
    let error
    assert.equal(await main([], { fetchImpl, stdout: () => assert.fail('unexpected output'), stderr: (text) => { error = text } }), 1)
    assert.match(error, expected)
  })
})

// A pending fetch must be aborted, rather than just racing a timeout while the
// underlying request continues. Also exercises failure after initialization.
function pendingRequest(_request, { signal }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request was not aborted')), 1000)
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

test('timeout aborts the actual pending request', async () => {
  const { fetchImpl } = server(null, pendingRequest)
  await assert.rejects(researchDeals('', { fetchImpl, timeoutMs: 15 }), { name: 'TimeoutError' })
})

test('caller cancellation aborts the request and returns exit code 130', async () => {
  const controller = new AbortController()
  const { fetchImpl } = server(null, (request, options) => {
    setImmediate(() => controller.abort(new Error('Cancelled')))
    return pendingRequest(request, options)
  })
  let error
  assert.equal(await main([], { fetchImpl, signal: controller.signal,
    stdout: () => assert.fail('unexpected output'), stderr: (text) => { error = text } }), 130)
  assert.match(error, /Cancelled/)
})

test('advertised npm command runs through the CLI and stays anonymous with saved keys present', async () => {
  const { stdout } = await run('npm', ['run', '--silent', 'research:deals', '--', 'Safeway ice cream 94941'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PARALLEL_API_KEY: 'unused-fixture-key', FIRECRAWL_API_KEY: 'unused-fixture-key',
      NODE_OPTIONS: `--import=${new URL('./fixtures/parallel-fetch.js', import.meta.url).href}` },
  })
  const output = JSON.parse(stdout)
  assert.equal(output.results[0].title, 'Fixture offer')
  assert.deepEqual(output.searchQueries, ['Safeway ice cream 94941'])
})

test('help does not connect to the network', async () => {
  let text
  assert.equal(await main(['--help'], { fetchImpl: () => assert.fail('network'), stdout: (out) => { text = out } }), 0)
  assert.match(text, /npm run research:deals/)
})
