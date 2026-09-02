import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: NodeJS.Dict<string | string[]>
  body: string
}

export interface StubResponse {
  status?: number
  json?: unknown
  raw?: string
}

/**
 * A real HTTP server standing in for Discord.
 *
 * Deliberately not an axios mock: the things most worth testing about a
 * generated client — how it serialises query parameters, which headers it
 * actually puts on the wire, whether a JSON body round-trips — all live below
 * the axios API surface an adapter mock would replace.
 */
export class StubServer {
  private server?: Server
  private handler: (request: RecordedRequest) => StubResponse = () => ({ status: 200, json: {} })
  readonly requests: RecordedRequest[] = []

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.dispatch(req, res))
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((resolve, reject) =>
      this.server!.close((error) => (error ? reject(error) : resolve())))
    this.server = undefined
  }

  get baseURL(): string {
    const address = this.server?.address() as AddressInfo | undefined
    if (!address) throw new Error('StubServer is not listening.')
    return `http://127.0.0.1:${address.port}`
  }

  /** Replaces the response handler and clears recorded traffic. */
  reply(handler: (request: RecordedRequest) => StubResponse): void {
    this.handler = handler
    this.requests.length = 0
  }

  get lastRequest(): RecordedRequest {
    const last = this.requests.at(-1)
    if (!last) throw new Error('No request was recorded.')
    return last
  }

  private dispatch(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      this.requests.push(recorded)

      const stub = this.handler(recorded)
      const body = stub.raw ?? JSON.stringify(stub.json ?? {})
      res.writeHead(stub.status ?? 200, { 'content-type': 'application/json' })
      res.end(body)
    })
  }
}
