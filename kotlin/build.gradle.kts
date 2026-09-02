import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.openapitools.generator.gradle.plugin.tasks.GenerateTask

plugins {
    kotlin("jvm") version "2.4.10"
    id("org.openapi.generator") version "7.25.0"
    `java-library`
    `maven-publish`
}

// Versions the generated client compiles and runs against. Kept aligned with
// ESA-Blueshell/website (Spring Boot 4.1.x, Java 25) so the published artefact
// drops into its primary consumer without a dependency conflict.
val springVersion = "7.0.9"
val jacksonVersion = "2.22.2"
val javaToolchain = 25

kotlin {
    jvmToolchain(javaToolchain)
    compilerOptions { jvmTarget.set(JvmTarget.JVM_25) }
}

java {
    // A sources jar makes the generated code navigable in a consumer's IDE,
    // which matters more than usual when nobody wrote it by hand. No javadoc
    // jar: Kotlin needs Dokka to produce anything, and GitHub Packages — unlike
    // Maven Central — does not require one, so the alternative is publishing an
    // empty artefact.
    withSourcesJar()
}

/**
 * The spec the generator consumes.
 *
 * Produced from the committed, versioned surface by the shared Node pipeline
 * rather than read directly: a handful of shapes in the upstream document
 * cannot be rendered by openapi-generator and need rewriting first. Those
 * rewrites live in `tools/src/fixups.mjs` so the TypeScript client applies the
 * identical set, and so `specs/discord.json` stays faithful to what upstream
 * actually publishes — it is the document release numbers are derived from.
 *
 * `tools/src/cli.mjs generator-input` reads only JSON and imports nothing, so
 * this needs a bare `node` on PATH and no `npm install`.
 */
val specSurface = layout.projectDirectory.file("../specs/discord.json")
val generatorInput = layout.buildDirectory.file("generator-input.json")

val prepareSpec = tasks.register<Exec>("prepareSpec") {
    group = "openapi"
    description = "Applies generator workarounds to the versioned spec surface."

    inputs.file(specSurface)
    inputs.file(layout.projectDirectory.file("../tools/src/fixups.mjs"))
    inputs.file(layout.projectDirectory.file("../tools/src/cli.mjs"))
    inputs.file(layout.projectDirectory.file("../tools/src/normalise.mjs"))
    outputs.file(generatorInput)

    workingDir = layout.projectDirectory.dir("..").asFile
    // Written into this project's own build directory rather than the
    // repository root, so `gradlew clean` reclaims it and the TypeScript
    // build cannot race it.
    commandLine("node", "tools/src/cli.mjs", "generator-input", generatorInput.get().asFile.absolutePath)

    doFirst {
        // A missing `node` otherwise surfaces as a bare "Cannot run program".
        val probe = providers.exec {
            commandLine("sh", "-c", "command -v node >/dev/null 2>&1 && echo yes || echo no")
        }.standardOutput.asText.get().trim()
        require(probe == "yes") {
            "`node` was not found on PATH. The generated client is derived from " +
                "../specs/discord.json by tools/src/cli.mjs, which needs Node 22+ " +
                "(no npm install required)."
        }
    }
}

val generatedRoot = layout.buildDirectory.dir("generated/openapi")

val generateClient = tasks.register<GenerateTask>("generateClient") {
    group = "openapi"
    description = "Generates the Kotlin Spring RestClient from the versioned spec surface."
    dependsOn(prepareSpec)

    // The surface is filtered and validated by the pipeline before it lands in
    // the repo, and openapi-generator's own validator rejects a few legitimate
    // OpenAPI 3.1 constructs Discord uses.
    validateSpec.set(false)

    generatorName.set("kotlin")
    library.set("jvm-spring-restclient")

    // 7.24 types these as RegularFileProperty / DirectoryProperty, so the
    // layout providers go in as-is and stay lazily evaluated.
    inputSpec.set(generatorInput)
    outputDir.set(generatedRoot)

    apiPackage.set("net.blueshell.clients.discord.api")
    modelPackage.set("net.blueshell.clients.discord.model")
    packageName.set("net.blueshell.clients.discord")

    configOptions.set(
        mapOf(
            "sourceFolder" to "src/main/kotlin",
            "serializationLibrary" to "jackson",
            "dateLibrary" to "java8",
            "useSpringBoot3" to "true",
            "enumPropertyNaming" to "UPPERCASE",
        ),
    )

    generateModelTests.set(false)
    generateApiTests.set(false)
    generateModelDocumentation.set(true)
    generateApiDocumentation.set(true)

    inlineSchemaOptions.set(mapOf("RESOLVE_INLINE_ENUMS" to "true"))

    globalProperties.set(
        mapOf(
            "apis" to "Discord",
            "models" to "",
            "supportingFiles" to "",
        ),
    )

    outputs.cacheIf { true }
}

sourceSets {
    // Derived from the generate task rather than from the layout, so the
    // provider carries the task dependency. Pointing at the directory alone
    // compiles fine but leaves `sourcesJar` reading an output nothing told it
    // to wait for, which Gradle 9 rejects as an implicit dependency.
    named("main") {
        kotlin.srcDir(generateClient.map { generatedRoot.get().dir("src/main/kotlin") })
    }
}

dependencies {
    api("org.springframework:spring-web:$springVersion")
    api("org.springframework:spring-core:$springVersion")

    api(platform("com.fasterxml.jackson:jackson-bom:$jacksonVersion"))
    api("com.fasterxml.jackson.core:jackson-annotations")
    api("com.fasterxml.jackson.core:jackson-databind")
    api("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
    api("com.fasterxml.jackson.module:jackson-module-kotlin")

    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")
    testImplementation("org.assertj:assertj-core:3.27.7")
    testImplementation("org.wiremock:wiremock:3.13.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("failed", "skipped") }
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            artifactId = "discord-client"
            pom {
                name.set("Discord API client (Kotlin)")
                description.set(
                    "Kotlin Spring RestClient for the subset of the Discord HTTP API " +
                        "declared in specs/surface.json. Generated; do not edit by hand.",
                )
                url.set("https://github.com/ESA-Blueshell/discord-client")
                licenses {
                    license {
                        name.set("MIT")
                        url.set("https://github.com/ESA-Blueshell/discord-client/blob/main/LICENSE")
                    }
                }
                scm {
                    url.set("https://github.com/ESA-Blueshell/discord-client")
                    connection.set("scm:git:https://github.com/ESA-Blueshell/discord-client.git")
                }
            }
        }
    }
    repositories {
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/ESA-Blueshell/discord-client")
            credentials {
                username = providers.gradleProperty("gpr.user")
                    .orElse(providers.environmentVariable("GITHUB_ACTOR")).orNull
                password = providers.gradleProperty("gpr.token")
                    .orElse(providers.environmentVariable("GITHUB_TOKEN")).orNull
            }
        }
    }
}
