package net.blueshell.clients.discord

import net.blueshell.clients.discord.api.DiscordApi
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import kotlin.reflect.full.declaredFunctions
import kotlin.reflect.jvm.javaMethod

/**
 * Pins the generated surface.
 *
 * The client is generated, so nothing here tests hand-written logic. What it
 * does test is that the spec pipeline still produces the client the version
 * number claims: if the surface filter silently drops an operation — the exact
 * failure that would ship a breaking change disguised as a patch — the build
 * fails here rather than at a consumer's call site.
 */
class DiscordApiSurfaceTest {

    private val operations: Set<String> =
        DiscordApi::class.declaredFunctions
            .map { it.name }
            .filterNot { it.endsWith("WithHttpInfo") }
            .filterNot { it.endsWith("RequestConfig") }
            .toSet()

    @Test
    fun `exposes exactly the operations declared in the consumed surface`() {
        assertThat(operations).containsExactlyInAnyOrder(
            "getMyUser",
            "getGuild",
            "listGuildMembers",
            "searchGuildMembers",
            "getGuildMember",
            "updateGuildMember",
            "listGuildRoles",
        )
    }

    @Test
    fun `models Discord snowflake identifiers as strings`() {
        // Discord IDs exceed Long on the 64-bit unsigned range and upstream
        // types them as string/snowflake. A generator or spec change that turned
        // these back into integers would compile but truncate real IDs.
        val getGuild = DiscordApi::class.declaredFunctions.single { it.name == "getGuild" }
        val guildId = getGuild.parameters.single { it.name == "guildId" }
        assertThat(guildId.type.classifier).isEqualTo(String::class)
    }

    @Test
    fun `paginates listGuildMembers with a string cursor`() {
        // Upstream changed `after` from integer to string/snowflake; this is the
        // assertion that records that decision rather than leaving it implicit.
        val listMembers = DiscordApi::class.declaredFunctions.single { it.name == "listGuildMembers" }
        val after = listMembers.parameters.single { it.name == "after" }
        assertThat(after.type.classifier).isEqualTo(String::class)
        assertThat(after.type.isMarkedNullable).isTrue()
    }

    @Test
    fun `can be constructed from a base url`() {
        assertThat(DiscordApi("https://discord.com/api/v10")).isNotNull()
    }

    @Test
    fun `every operation is public`() {
        assertThat(DiscordApi::class.declaredFunctions.mapNotNull { it.javaMethod })
            .allMatch { java.lang.reflect.Modifier.isPublic(it.modifiers) }
    }
}
