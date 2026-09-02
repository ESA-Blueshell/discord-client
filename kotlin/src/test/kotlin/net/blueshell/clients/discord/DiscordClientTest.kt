package net.blueshell.clients.discord

import net.blueshell.clients.discord.api.DiscordApi
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClient

class DiscordClientTest {

    @Test
    fun `rejects a blank token rather than sending an unauthenticated request`() {
        assertThatThrownBy { DiscordClient.create(botToken = "   ") }
            .isInstanceOf(IllegalArgumentException::class.java)
            .hasMessageContaining("non-blank botToken")
    }

    @Test
    fun `rejects a token that already carries the Bot prefix`() {
        // Prefixing twice yields "Bot Bot <token>", which Discord rejects as a
        // malformed token rather than as a bad one — confusing to debug.
        assertThatThrownBy { DiscordClient.create(botToken = "Bot abc") }
            .isInstanceOf(IllegalArgumentException::class.java)
            .hasMessageContaining("bare bot token")
    }

    @Test
    fun `rejects the prefix regardless of case or leading whitespace`() {
        assertThatThrownBy { DiscordClient.create(botToken = "  bot abc") }
            .isInstanceOf(IllegalArgumentException::class.java)
    }

    @Test
    fun `builds an api for a valid token`() {
        assertThat(DiscordClient.create(botToken = "valid-token")).isInstanceOf(DiscordApi::class.java)
    }

    @Test
    fun `wraps a caller-supplied RestClient`() {
        val restClient = RestClient.builder().baseUrl(DiscordClient.DEFAULT_BASE_URL).build()
        assertThat(DiscordClient.using(restClient)).isInstanceOf(DiscordApi::class.java)
    }

    @Test
    fun `defaults to the versioned base url`() {
        assertThat(DiscordClient.DEFAULT_BASE_URL).isEqualTo("https://discord.com/api/v10")
    }
}
