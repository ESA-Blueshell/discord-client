package net.blueshell.clients.discord

import com.github.tomakehurst.wiremock.WireMockServer
import com.github.tomakehurst.wiremock.client.WireMock.aResponse
import com.github.tomakehurst.wiremock.client.WireMock.equalTo
import com.github.tomakehurst.wiremock.client.WireMock.equalToJson
import com.github.tomakehurst.wiremock.client.WireMock.get
import com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor
import com.github.tomakehurst.wiremock.client.WireMock.patch
import com.github.tomakehurst.wiremock.client.WireMock.patchRequestedFor
import com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo
import com.github.tomakehurst.wiremock.core.WireMockConfiguration.options
import net.blueshell.clients.discord.api.DiscordApi
import net.blueshell.clients.discord.model.UpdateGuildMemberRequest
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClientResponseException

/**
 * Exercises the generated client against a stubbed Discord.
 *
 * Two things are worth testing about a generated client, and they are tested
 * separately here:
 *
 *  - **Request wiring** — that an operation targets the right method, path,
 *    path parameters and query parameters. Asserted with `server.verify`, which
 *    needs no response fixture, so these tests do not rot when upstream adds a
 *    field.
 *  - **Response deserialisation** — that the Jackson wiring works at all.
 *    Proven on the two lightest models. Discord's guild and member payloads
 *    require thirty-odd non-null fields across four levels of nullable wrapper
 *    types; hand-building those would test the fixture, not the client, and
 *    would break on every upstream field addition. The mechanism is shared by
 *    every model, so proving it twice is enough.
 */
class DiscordApiRoundTripTest {

    companion object {
        private lateinit var server: WireMockServer
        lateinit var api: DiscordApi

        @BeforeAll
        @JvmStatic
        fun start() {
            server = WireMockServer(options().dynamicPort())
            server.start()
            // Through the factory, not the generated constructor: the factory is
            // what wires authentication and puts the NON_ABSENT serialiser in
            // front of Spring's default converter.
            api = DiscordClient.create(botToken = "test-token", baseUrl = server.baseUrl())
        }

        @AfterAll
        @JvmStatic
        fun stop() = server.stop()

        /** A complete UserPIIResponse: every non-null field, all scalars. */
        private val CURRENT_USER_JSON = """
            {
              "id": "80351110224678912",
              "username": "nelly",
              "discriminator": "1337",
              "global_name": null,
              "avatar": null,
              "flags": 64,
              "public_flags": 64,
              "mfa_enabled": true,
              "locale": "en-US"
            }
        """.trimIndent()

        /** A complete GuildRoleResponse, including its nested colours object. */
        private val ROLE_JSON = """
            {
              "id": "41771983423143936",
              "name": "Board",
              "color": 3447003,
              "colors": { "primary_color": 3447003, "secondary_color": null, "tertiary_color": null },
              "hoist": true,
              "position": 1,
              "permissions": "66321471",
              "managed": false,
              "mentionable": false,
              "icon": null,
              "unicode_emoji": null,
              "flags": 0
            }
        """.trimIndent()
    }

    @BeforeEach
    fun reset() = server.resetAll()

    private fun stubJson(method: String, path: String, body: String, status: Int = 200) {
        val response = aResponse()
            .withStatus(status)
            .withHeader("Content-Type", "application/json")
            .withBody(body)
        when (method) {
            "GET" -> server.stubFor(get(urlPathEqualTo(path)).willReturn(response))
            "PATCH" -> server.stubFor(patch(urlPathEqualTo(path)).willReturn(response))
            else -> error("Unsupported stub method $method")
        }
    }

    // ── Response deserialisation ────────────────────────────────────────────

    @Test
    fun `getMyUser deserialises the current user`() {
        stubJson("GET", "/users/@me", CURRENT_USER_JSON)

        val user = api.getMyUser()

        assertThat(user.id).isEqualTo("80351110224678912")
        assertThat(user.username).isEqualTo("nelly")
        assertThat(user.mfaEnabled).isTrue()
        // Snowflakes must survive as strings; 80351110224678912 would lose
        // precision the moment anything treated it as a JSON number.
        assertThat(user.id).hasSize(17)
    }

    @Test
    fun `listGuildRoles deserialises a role array including nested colours`() {
        stubJson("GET", "/guilds/123/roles", "[$ROLE_JSON]")

        val roles = api.listGuildRoles(guildId = "123")

        assertThat(roles).singleElement().satisfies({
            assertThat(it.name).isEqualTo("Board")
            assertThat(it.permissions).isEqualTo("66321471")
            assertThat(it.colors.primaryColor).isEqualTo(3447003)
            assertThat(it.colors.secondaryColor).isNull()
        })
    }

    @Test
    fun `tolerates unknown fields so an upstream addition is not a breaking change`() {
        // The generated Serializer disables FAIL_ON_UNKNOWN_PROPERTIES. That is
        // what makes an additive upstream change a minor rather than a client
        // crash, so it is worth pinning rather than assuming.
        stubJson("GET", "/users/@me", CURRENT_USER_JSON.dropLast(1) + """, "brand_new_field": "surprise" }""")

        assertThat(api.getMyUser().username).isEqualTo("nelly")
    }

    // ── Request wiring ──────────────────────────────────────────────────────

    @Test
    fun `getGuild sends withCounts as a query parameter`() {
        // Asserted against an error response on purpose: the request is what
        // this test is about, and a full guild fixture would need ~30 non-null
        // fields to prove nothing extra.
        stubJson("GET", "/guilds/123", """{"code":0,"message":"nope"}""", status = 500)

        assertThatThrownBy { api.getGuild(guildId = "123", withCounts = true) }
            .isInstanceOf(RestClientResponseException::class.java)

        server.verify(
            getRequestedFor(urlPathEqualTo("/guilds/123"))
                .withQueryParam("with_counts", equalTo("true")),
        )
    }

    @Test
    fun `listGuildMembers passes the snowflake cursor through untouched`() {
        // A 19-digit snowflake survives only because `after` is a String; it
        // would silently truncate if the parameter regressed to a numeric type.
        val snowflake = "1234567890123456789"
        stubJson("GET", "/guilds/123/members", "[]")

        api.listGuildMembers(guildId = "123", limit = 100, after = snowflake)

        server.verify(
            getRequestedFor(urlPathEqualTo("/guilds/123/members"))
                .withQueryParam("after", equalTo(snowflake))
                .withQueryParam("limit", equalTo("100")),
        )
    }

    @Test
    fun `searchGuildMembers sends the query parameter`() {
        stubJson("GET", "/guilds/123/members/search", "[]")

        api.searchGuildMembers(guildId = "123", query = "nelly", limit = 10)

        server.verify(
            getRequestedFor(urlPathEqualTo("/guilds/123/members/search"))
                .withQueryParam("query", equalTo("nelly"))
                .withQueryParam("limit", equalTo("10")),
        )
    }

    @Test
    fun `updateGuildMember PATCHes only the fields that were set`() {
        // On a Discord PATCH an explicit null means "clear this field", so a
        // client that fills in nulls for everything unset would wipe a member's
        // roles and nickname on any update. Asserted as exact body equality
        // rather than with ignoreExtraElements, because the extra elements are
        // precisely the bug.
        stubJson("PATCH", "/guilds/123/members/456", """{"code":0,"message":"nope"}""", status = 500)

        assertThatThrownBy {
            api.updateGuildMember(
                guildId = "123",
                userId = "456",
                updateGuildMemberRequest = UpdateGuildMemberRequest(nick = "Chair"),
            )
        }.isInstanceOf(RestClientResponseException::class.java)

        server.verify(
            patchRequestedFor(urlPathEqualTo("/guilds/123/members/456"))
                .withRequestBody(equalToJson("""{"nick":"Chair"}""")),
        )
        assertThat(server.allServeEvents.single().request.bodyAsString)
            .isEqualTo("""{"nick":"Chair"}""")
    }

    @Test
    fun `sends the bot authorization header on every request`() {
        stubJson("GET", "/users/@me", CURRENT_USER_JSON)

        api.getMyUser()

        server.verify(getRequestedFor(urlPathEqualTo("/users/@me")).withHeader("Authorization", equalTo("Bot test-token")))
    }

    @Test
    fun `surfaces an upstream error as a RestClientResponseException carrying the status`() {
        // Consumers need the status code to tell a rate limit from a permission
        // problem, so the error must not be flattened into a null result.
        stubJson("GET", "/guilds/404", """{"code":10004,"message":"Unknown Guild"}""", status = 404)

        assertThatThrownBy { api.getGuild(guildId = "404") }
            .isInstanceOf(RestClientResponseException::class.java)
            .satisfies({ assertThat((it as RestClientResponseException).statusCode.value()).isEqualTo(404) })
    }
}
