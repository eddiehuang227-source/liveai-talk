import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('bundle patch inserts the host/client row by package name', () => {
  assert.match(patch, /- insert:/)
  assert.match(patch, /- id: flowact-avatar/)
  assert.match(patch, /name: 'dsh-flowact-avatar'/)
})

test('bundle patch carries override-friendly configuration defaults', () => {
  assert.match(patch, /title: 'FlowAct 数字人'/)
  assert.match(patch, /defaultCharacter: 'chie'/)
  assert.match(patch, /providerPolicy:/)
  assert.match(patch, /tts: 'auto'/)
  assert.match(patch, /asr: 'auto'/)
  assert.match(patch, /avatarMedia: 'jimeng'/)
})
