import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('bundle patch inserts the host/client row by package name', () => {
  assert.match(patch, /- insert:/)
  assert.match(patch, /- id: liveai-talk/)
  assert.match(patch, /name: 'dsh-liveai-talk'/)
})

test('bundle patch carries override-friendly configuration defaults', () => {
  assert.match(patch, /title: 'LiveAI Talk'/)
  assert.match(patch, /defaultCharacter: 'chie'/)
  assert.match(patch, /providerPolicy:/)
  assert.match(patch, /tts: 'auto'/)
  assert.match(patch, /asr: 'auto'/)
  assert.match(patch, /avatarMedia: 'jimeng'/)
})
