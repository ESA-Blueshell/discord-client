#!/usr/bin/env node
/**
 * Rewrites the relative import specifiers TypeScript emits so the built package
 * is loadable as real ESM.
 *
 * The generated sources import with extensionless, sometimes directory-shaped
 * specifiers — `export * from './generated/client'`. TypeScript's `bundler`
 * module resolution accepts those and emits them unchanged, which is fine for a
 * bundler and invalid for Node:
 *
 *   ERR_UNSUPPORTED_DIR_IMPORT: Directory import '.../dist/generated/client'
 *   is not supported resolving ES modules
 *
 * That is not a theoretical concern: it broke `vitest` in the consuming
 * application while working perfectly under Vite, because one resolves through
 * Node and the other through the bundler.
 *
 * Rather than fight the generator's import style, the emitted output is
 * rewritten here: `./x` becomes `./x.js` when that file exists, or
 * `./x/index.js` when the target is a directory.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const distDir = resolve(process.argv[2] ?? 'dist')

/** Every relative `from '...'` / `import('...')` specifier in a module. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*)\2/g

function resolveSpecifier(fileDir, specifier) {
  // Already explicit; leave it alone.
  if (specifier.endsWith('.js') || specifier.endsWith('.mjs')) return null

  const target = join(fileDir, specifier)
  try {
    if (statSync(target).isDirectory()) {
      statSync(join(target, 'index.js'))
      return `${specifier}/index.js`
    }
  } catch {
    // Not a directory; fall through to the file case.
  }
  try {
    statSync(`${target}.js`)
    return `${specifier}.js`
  } catch {
    return null
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      rewrite(full)
    }
  }
}

let rewritten = 0

function rewrite(file) {
  const source = readFileSync(file, 'utf8')
  const fileDir = dirname(file)
  const output = source.replace(SPECIFIER, (match, prefix, quote, specifier) => {
    const fixed = resolveSpecifier(fileDir, specifier)
    if (fixed === null) return match
    rewritten += 1
    return `${prefix}${quote}${fixed}${quote}`
  })
  if (output !== source) writeFileSync(file, output)
}

walk(distDir)
console.log(`Rewrote ${rewritten} relative specifier(s) under ${distDir}.`)
