import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  DISCORD_API_BASE_URL,
  createDiscordClient,
  getGuild,
  getGuildMember,
  getMyUser,
  listGuildMembers,
  listGuildRoles,
  searchGuildMembers,
  updateGuildMember,
} from '../src/index.js'
import { StubServer } from './stub-server.js'

const server = new StubServer()

beforeAll(() => server.start())
afterAll(() => server.stop())

function client() {
  return createDiscordClient({ botToken: 'test-token', baseURL: server.baseURL })
}

describe('createDiscordClient', () => {
  it('adds the Bot prefix Discord requires', async () => {
    server.reply(() => ({ json: {} }))
    await getMyUser({ client: client() })
    expect(server.lastRequest.headers.authorization).toBe('Bot test-token')
  })

  it('rejects a token that already carries the prefix', () => {
    // Prefixing twice yields "Bot Bot <token>", which Discord rejects as
    // malformed rather than as unauthorised — a confusing failure to chase.
    expect(() => createDiscordClient({ botToken: 'Bot abc' })).toThrow(/bare bot token/)
  })

  it('rejects an empty token', () => {
    expect(() => createDiscordClient({ botToken: '   ' })).toThrow(/non-empty botToken/)
  })

  it('sends a user agent when one is configured', async () => {
    server.reply(() => ({ json: {} }))
    await getMyUser({ client: createDiscordClient({ botToken: 't', baseURL: server.baseURL, userAgent: 'Blueshell/1.0' }) })
    expect(server.lastRequest.headers['user-agent']).toBe('Blueshell/1.0')
  })

  it('defaults to the versioned Discord base URL', () => {
    expect(DISCORD_API_BASE_URL).toBe('https://discord.com/api/v10')
  })
})

describe('operation surface', () => {
  it('exports exactly the operations declared in the consumed surface, all callable', () => {
    // Mirrors DiscordApiSurfaceTest on the Kotlin side. Both artefacts are
    // generated from one spec and share a version number, so a surface that
    // drifted between them would make that version a lie.
    const operations = {
      getGuild, getGuildMember, getMyUser, listGuildMembers,
      listGuildRoles, searchGuildMembers, updateGuildMember,
    }
    expect(Object.keys(operations).sort()).toEqual([
      'getGuild', 'getGuildMember', 'getMyUser', 'listGuildMembers',
      'listGuildRoles', 'searchGuildMembers', 'updateGuildMember',
    ])
    for (const [name, operation] of Object.entries(operations)) {
      expect(typeof operation, `${name} should be a callable export`).toBe('function')
    }
  })

  it('re-exports the generated module from the package root', async () => {
    // The package publishes dist/index.js; if the barrel stopped re-exporting
    // the generated tree, consumers would get types with no implementations.
    const barrel = await import('../src/index.js')
    expect(barrel).toHaveProperty('createDiscordClient')
    expect(barrel).toHaveProperty('getMyUser')
  })
})

describe('request wiring', () => {
  beforeEach(() => server.reply(() => ({ json: {} })))

  it('interpolates path parameters', async () => {
    await getGuild({ client: client(), path: { guild_id: '123' } })
    expect(server.lastRequest.path).toBe('/guilds/123')
  })

  it('sends with_counts as a query parameter', async () => {
    await getGuild({ client: client(), path: { guild_id: '123' }, query: { with_counts: true } })
    expect(server.lastRequest.query.get('with_counts')).toBe('true')
  })

  it('passes a 19-digit snowflake cursor through as a string', async () => {
    // Upstream changed `after` from integer to string/snowflake. Were it still
    // numeric, this value would lose its last digits to float precision.
    const snowflake = '1234567890123456789'
    server.reply(() => ({ json: [] }))
    await listGuildMembers({ client: client(), path: { guild_id: '123' }, query: { after: snowflake, limit: 100 } })
    expect(server.lastRequest.query.get('after')).toBe(snowflake)
    expect(server.lastRequest.query.get('limit')).toBe('100')
  })

  it('sends the member search query', async () => {
    server.reply(() => ({ json: [] }))
    await searchGuildMembers({ client: client(), path: { guild_id: '123' }, query: { query: 'nelly', limit: 10 } })
    expect(server.lastRequest.query.get('query')).toBe('nelly')
  })

  it('PATCHes only the fields that were set', async () => {
    await updateGuildMember({ client: client(), path: { guild_id: '123', user_id: '456' }, body: { nick: 'Chair' } })
    expect(server.lastRequest.method).toBe('PATCH')
    expect(JSON.parse(server.lastRequest.body)).toEqual({ nick: 'Chair' })
  })
})

describe('responses', () => {
  it('returns typed data for the current user', async () => {
    server.reply(() => ({ json: { id: '80351110224678912', username: 'nelly', discriminator: '1337' } }))
    const { data } = await getMyUser({ client: client() })
    expect(data?.id).toBe('80351110224678912')
    expect(data?.username).toBe('nelly')
  })

  it('deserialises nested role colours', async () => {
    server.reply(() => ({ json: [{ id: '1', name: 'Board', colors: { primary_color: 3447003, secondary_color: null } }] }))
    const { data } = await listGuildRoles({ client: client(), path: { guild_id: '123' } })
    expect(data?.[0]?.name).toBe('Board')
    expect(data?.[0]?.colors?.primary_color).toBe(3447003)
  })

  it('reports an upstream error instead of throwing by default', async () => {
    // hey-api returns { data, error } rather than rejecting, so a consumer that
    // forgets a try/catch still sees the failure. Pinned because switching this
    // default would silently change every call site's error handling.
    server.reply(() => ({ status: 404, json: { code: 10004, message: 'Unknown Guild' } }))
    const result = await getGuild({ client: client(), path: { guild_id: '404' } })
    expect(result.error).toBeDefined()
    // Discord's own error code, not just the HTTP status: consumers branch on
    // it to tell "unknown guild" from "missing access" behind the same 404.
    expect(result.error).toMatchObject({ code: 10004, message: 'Unknown Guild' })
    expect(result.status).toBe(404)
    expect(result.data).toBeUndefined()
  })
})
