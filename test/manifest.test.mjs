import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

test('package declares the dsh bundle and client manifests', () => {
  assert.equal(pkg.name, 'dsh-flowact-avatar')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
})

test('package exports the loader entry, client bundle, and patch', () => {
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
})

test('package ships a self-contained prepare script for git installs', () => {
  assert.match(pkg.scripts.prepare, /node scripts\/build\.mjs/)
})

test('built artifacts referenced by package.json exist', () => {
  for (const file of ['lib/index.js', 'lib/client.js']) {
    const path = new URL(file, root)
    assert.doesNotThrow(() => readFileSync(path, 'utf8'), `${file} must exist (run npm run build)`)
  }
  const client = readFileSync(new URL('lib/client.js', root), 'utf8')
  assert.match(client, /window\.__ModuleLoader__\.load/)
  assert.match(client, /id: 'dsh-flowact-avatar'/)
})

test('package files list includes the install-time essentials', () => {
  for (const file of ['lib', 'cordis.patch.yml', 'README.md']) {
    assert.ok(pkg.files.includes(file), `files must include ${file}`)
  }
})
