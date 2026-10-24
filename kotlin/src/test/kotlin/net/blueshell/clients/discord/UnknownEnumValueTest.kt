package net.blueshell.clients.discord

import net.blueshell.clients.discord.infrastructure.Serializer
import net.blueshell.clients.discord.model.ActivityActionTypes
import net.blueshell.clients.discord.model.GuildFeatures
import net.blueshell.clients.discord.model.GuildWithCountsResponse
import net.blueshell.clients.discord.model.MessageActivityResponse
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import tools.jackson.module.kotlin.readValue

/**
 * Discord adds enum values (a server feature, an activity type) without a new API version. Each
 * generated enum reads a value it does not know as its unknown case, through the client's own
 * mapper, whose Kotlin module keeps its strict null checks on.
 */
class UnknownEnumValueTest {
    private val mapper = Serializer.jacksonObjectMapper

    @Test
    fun `reads a single value the spec does not have as the unknown case`() {
        val read = mapper.readValue<MessageActivityResponse>("""{"type": 99, "party_id": "p1"}""")

        assertThat(read.type).isEqualTo(ActivityActionTypes.UNKNOWN_DEFAULT_OPEN_API)
        assertThat(read.partyId).isEqualTo("p1")
    }

    @Test
    fun `reads a server whose features hold a value the spec does not have`() {
        val read = mapper.readValue<GuildWithCountsResponse>(guild(features = """["COMMUNITY", "TEXT_IN_VOICE_ENABLED"]"""))

        assertThat(read.features).containsExactlyInAnyOrder(GuildFeatures.COMMUNITY, GuildFeatures.UNKNOWN_DEFAULT_OPEN_API)
        assertThat(read.emojis.map { it.name }).containsExactly("blueshell")
    }

    private fun guild(features: String) =
        """
        {
          "id": "1", "name": "Blueshell", "icon": null, "description": null, "home_header": null,
          "splash": null, "discovery_splash": null, "banner": null, "owner_id": "2",
          "application_id": null, "region": "europe", "afk_channel_id": null, "afk_timeout": 300,
          "system_channel_id": null, "system_channel_flags": 0, "widget_enabled": false,
          "widget_channel_id": null, "verification_level": 1, "roles": [],
          "default_message_notifications": 1, "mfa_level": 0, "explicit_content_filter": 2,
          "max_presences": null, "max_members": 500000, "max_stage_video_channel_users": 50,
          "max_video_channel_users": 25, "vanity_url_code": null, "premium_tier": 1,
          "premium_subscription_count": 2, "preferred_locale": "en-US", "rules_channel_id": null,
          "safety_alerts_channel_id": null, "public_updates_channel_id": null,
          "premium_progress_bar_enabled": false, "nsfw": false, "nsfw_level": 0,
          "features": $features, "stickers": [],
          "emojis": [{"id": "3", "name": "blueshell", "roles": [], "require_colons": true,
            "managed": false, "animated": false, "available": true}]
        }
        """.trimIndent()
}
