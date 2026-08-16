/**
 * Self-contained prepare/build script for dsh-flowact-avatar.
 *
 * `prepare` runs after a git dependency install and must not assume a sibling
 * monorepo checkout. This build only copies the dependency-free ESM sources
 * into `lib/`; no external toolchain is required.
 */

import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src')
const output = join(root, 'lib')

rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
cpSync(source, output, { recursive: true })

process.stdout.write(`[dsh-flowact-avatar] built ${output}\n`)
