/**
 * Public surface of the Discord client.
 *
 * Everything under `./generated` is produced by `@hey-api/openapi-ts` from
 * `specs/discord.json` and is overwritten on every spec sync — never edit it.
 * This module is the only hand-written file: it re-exports the generated
 * operations and adds the small amount of wiring every consumer would otherwise
 * repeat (base URL, bot authentication, a sane user agent).
 */

import { createClient, createConfig, type Client } from './generated/client'
import type { ClientOptions } from './generated/types.gen'

export * from './generated'
export type { Client } from './generated/client'

/** Discord's current REST base URL. Versioned, so a major bump is deliberate. */
export const DISCORD_API_BASE_URL = 'https://discord.com/api/v10'

export interface DiscordClientOptions {
  /**
   * A bot token, without the `Bot ` prefix — it is added here so callers
   * cannot accidentally send a bare token, which Discord rejects with a 401
   * that says nothing about the cause.
   */
  botToken: string
  /** Override the base URL; useful only for tests and proxies. */
  baseURL?: string
  /**
   * Sent as `User-Agent`. Discord's API documentation asks for a descriptive
   * one and rate-limits anonymous-looking traffic more aggressively.
   */
  userAgent?: string
  /** Request timeout in milliseconds. */
  timeoutMs?: number
}

/**
 * Builds a client bound to a bot token.
 *
 * Pass the result to any generated operation as `{ client }`:
 *
 * ```ts
 * const client = createDiscordClient({ botToken: process.env.DISCORD_BOT_TOKEN! })
 * const { data } = await getMyUser({ client })
 * ```
 */
export function createDiscordClient(options: DiscordClientOptions): Client {
  const { botToken, baseURL = DISCORD_API_BASE_URL, userAgent, timeoutMs } = options

  if (botToken.trim() === '') {
    throw new Error('createDiscordClient requires a non-empty botToken.')
  }
  if (/^Bot\s/i.test(botToken)) {
    // Prefixing twice yields `Bot Bot <token>`, which Discord rejects as a
    // malformed token rather than as a bad one — a confusing failure to debug.
    throw new Error('Pass the bare bot token to createDiscordClient; the "Bot " prefix is added for you.')
  }

  return createClient(
    createConfig<ClientOptions>({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: `Bot ${botToken}`,
        ...(userAgent === undefined ? {} : { 'User-Agent': userAgent }),
      },
    }),
  )
}
