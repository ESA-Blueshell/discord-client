package net.blueshell.clients.discord

import net.blueshell.clients.discord.api.DiscordApi
import net.blueshell.clients.discord.infrastructure.Serializer
import org.springframework.http.MediaType
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient

/**
 * Authenticated entry point for the Discord API.
 *
 * The generated [DiscordApi] does have a `DiscordApi(baseUrl)` convenience
 * constructor, and it is a trap on two counts:
 *
 *  - It wires **no authentication**. openapi-generator does not translate
 *    Discord's bearer scheme into the Kotlin `jvm-spring-restclient` library,
 *    so every call goes out unauthenticated and comes back 401.
 *  - Its converter setup is correct under Jackson 3, so this factory mirrors
 *    it rather than replacing it.
 *
 * So authentication is the reason this exists. It is the only hand-written
 * Kotlin in the repository; everything under `.api` and `.model` is generated.
 */
object DiscordClient {

    /** Discord's current REST base URL. Versioned, so a major bump is deliberate. */
    const val DEFAULT_BASE_URL: String = "https://discord.com/api/v10"

    /**
     * Builds an API bound to a bot token.
     *
     * @param botToken the bare token, without the `Bot ` prefix — it is added
     *   here so a caller cannot accidentally send `Bot Bot <token>`, which
     *   Discord rejects as malformed rather than as unauthorised.
     * @param userAgent sent as `User-Agent`; Discord's documentation asks for a
     *   descriptive one and rate-limits anonymous-looking traffic harder.
     * @param baseUrl override; useful only for tests and proxies.
     */
    @JvmStatic
    @JvmOverloads
    fun create(
        botToken: String,
        userAgent: String? = null,
        baseUrl: String = DEFAULT_BASE_URL,
    ): DiscordApi {
        require(botToken.isNotBlank()) { "DiscordClient.create requires a non-blank botToken." }
        require(!botToken.trimStart().startsWith("Bot ", ignoreCase = true)) {
            "Pass the bare bot token to DiscordClient.create; the \"Bot \" prefix is added for you."
        }

        val builder = RestClient.builder()
            .baseUrl(baseUrl)
            .defaultHeader("Authorization", "Bot $botToken")
            .defaultHeader("Accept", MediaType.APPLICATION_JSON_VALUE)
            // `withJsonConverter` replaces the default JSON converter rather
            // than adding a second one behind it, so the generated Serializer's
            // mapper is the one that actually runs. That matters: it sets
            // NON_ABSENT inclusion, and on a Discord PATCH an explicit null
            // means "clear this field" — a client that helpfully filled in
            // nulls would wipe a member's roles while setting their nickname.
            .configureMessageConverters {
                it.registerDefaults().withJsonConverter(JacksonJsonHttpMessageConverter(Serializer.jacksonObjectMapper))
            }

        if (userAgent != null) {
            builder.defaultHeader("User-Agent", userAgent)
        }

        return DiscordApi(builder.build())
    }

    /**
     * Wraps a [RestClient] the caller has already configured.
     *
     * For applications that route every outbound call through their own builder
     * — timeouts, retries, metrics, tracing. Authentication is then the
     * caller's responsibility.
     */
    @JvmStatic
    fun using(restClient: RestClient): DiscordApi = DiscordApi(restClient)
}
