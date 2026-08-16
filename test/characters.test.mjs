import test from 'node:test'
import assert from 'node:assert/strict'
import { builtinCharacterById, builtinCharacters } from '../lib/core/characters.js'

const CAPABILITY_KEYS = ['tts', 'asr', 'avatarMedia']

test('built-in characters follow the manifest shape', () => {
  assert.ok(builtinCharacters.length >= 1)
  for (const character of builtinCharacters) {
    assert.match(character.id, /^[a-z0-9][a-z0-9-]{0,63}$/)
    assert.ok(character.name.trim())
    assert.ok(character.persona.trim())
    assert.ok(character.previewUrl.startsWith('/live/assets/'))
    assert.match(character.defaultEmotion, /^[a-z][a-z0-9-]*$/)
    for (const key of CAPABILITY_KEYS) {
      assert.ok(character.providers[key], `${character.id} must declare ${key} routing`)
      assert.ok(character.providers[key].id)
    }
  }
})

test('built-in ids are unique', () => {
  const ids = builtinCharacters.map((character) => character.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('default character lookup resolves and misses return null', () => {
  assert.equal(builtinCharacterById('chie').id, 'chie')
  assert.equal(builtinCharacterById('missing'), null)
})
