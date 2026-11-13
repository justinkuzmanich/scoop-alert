// Optional, read-only research. Search excerpts are leads, never verified prices.
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { BRANDS, PRIMARY_STORE } from '../src/data/config.js'

const ENDPOINT = 'https://search.parallel.ai/mcp'
const USER_AGENT = 'scoop-alert/0.1.0 (+https://github.com/justinkuzmanich/scoop-alert)'
const PROTOCOL = '2025-03-26'

// Streamable HTTP can return either JSON or SSE. Stop reading as soon as the
// matching response arrives, even if the server keeps the SSE connection open.
async function readResponse(response, id) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    return response.json()
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, '')).join('\n')
        if (!data) continue
        const message = JSON.parse(data)
        if (message.id === id) return message
      }
    }
    throw new Error('MCP stream ended without a matching response')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function researchDeals(query = '', {
  fetchImpl = globalThis.fetch, signal, timeoutMs = 30_000,
} = {}) {
  const requestSignal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : []),
  ])
  let nextId = 0
  let sessionHeader
  let protocol
  async function rpc(method, params, notification = false) {
    const id = notification ? undefined : ++nextId
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'User-Agent': USER_AGENT,
        ...(sessionHeader ? { 'Mcp-Session-Id': sessionHeader } : {}),
        ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: requestSignal,
      redirect: 'error',
    })
    if (!response.ok) {
      throw new Error(`Parallel MCP HTTP ${response.status}: ${await response.text()}`)
    }
    if (method === 'initialize') sessionHeader = response.headers.get('mcp-session-id')
    if (notification) {
      await response.body?.cancel()
      return
    }
    const message = await readResponse(response, id)
    if (message.jsonrpc !== '2.0' || message.id !== id) throw new Error('Invalid MCP response')
    if (message.error) throw new Error(`Parallel MCP: ${message.error.message}`)
    if (!message.result) throw new Error('Missing MCP result')
    return message.result
  }

  const initialized = await rpc('initialize', {
    protocolVersion: PROTOCOL, capabilities: {},
    clientInfo: { name: 'scoop-alert', version: '0.1.0' },
  })
  protocol = initialized.protocolVersion
  if (protocol !== PROTOCOL) throw new Error(`Unsupported MCP protocol: ${protocol}`)
  await rpc('notifications/initialized', {}, true)

  const date = new Date().toISOString().slice(0, 10)
  const searchQueries = query.trim() ? [query.trim()] : BRANDS.map((brand) =>
    `Safeway ${brand.name} sale ${PRIMARY_STORE.postalCode}`)
  const objective = `Find public Safeway ice cream offers for ${PRIMARY_STORE.name}, ZIP ${PRIMARY_STORE.postalCode}, as of ${date}. ` +
    'Look for prices, package sizes, validity dates and purchase or membership conditions. Return sources for manual verification.'
  const tool = await rpc('tools/call', {
    name: 'web_search',
    arguments: { objective, search_queries: searchQueries, session_id: randomUUID() },
  })
  if (tool.isError) {
    throw new Error((tool.content || []).filter((c) => c.type === 'text')
      .map((c) => c.text).join('\n') || 'Parallel search failed')
  }
  // MCP servers may provide structured output, JSON text, or both.
  const data = tool.structuredContent ?? JSON.parse(
    (tool.content || []).find((c) => c.type === 'text')?.text || 'null')
  if (!Array.isArray(data?.results) || data.results.some((result) =>
    !/^https?:\/\//i.test(result.url) || !Array.isArray(result.excerpts) ||
    result.excerpts.some((excerpt) => typeof excerpt !== 'string'))) {
    throw new Error('Unexpected Parallel search result format')
  }
  return {
    researchedAt: new Date().toISOString(),
    note: 'Research leads only. Verify store, dates, package size and membership terms before adding a manual deal.',
    searchQueries,
    results: data.results,
    warnings: data.warnings || [],
  }
}

export async function main(args, {
  stdout = console.log, stderr = console.error, ...options
} = {}) {
  if (args.includes('--help')) {
    stdout('Usage: npm run research:deals -- [search query]\n' +
      'Without a query, searches the configured brands and primary store ZIP.\n' +
      'Prints research JSON only; never writes deals or sends alerts. Requires Node.js 22+.')
    return 0
  }
  try {
    stdout(JSON.stringify(await researchDeals(args.join(' '), options), null, 2))
    return 0
  } catch (error) {
    stderr(`Deal research failed: ${error.message}`)
    return options.signal?.aborted ? 130 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()
  const cancel = () => controller.abort(new Error('Cancelled'))
  process.once('SIGINT', cancel)
  try {
    process.exitCode = await main(process.argv.slice(2), { signal: controller.signal })
  } finally {
    process.removeListener('SIGINT', cancel)
  }
}
