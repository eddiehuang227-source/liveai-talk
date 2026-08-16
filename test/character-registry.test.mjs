import test from 'node:test'
import assert from 'node:assert/strict'
import { CharacterRegistry, CharacterRegistryError } from '../lib/core/character-registry.js'

function character(id, name = id) {
  return { id, name }
}

test('registers and lists characters', () => {
  const registry = new CharacterRegistry()
  const dispose = registry.register(character('chie', '星之宫知惠'))
  assert.equal(registry.has('chie'), true)
  assert.equal(registry.list().length, 1)
  assert.equal(registry.get('chie').name, '星之宫知惠')
  dispose()
  assert.equal(registry.has('chie'), false)
})

test('duplicate character ids fail loud', () => {
  const registry = new CharacterRegistry()
  registry.register(character('chie'))
  assert.throws(() => registry.register(character('chie')), (error) => {
    assert.ok(error instanceof CharacterRegistryError)
    assert.equal(error.code, 'DUPLICATE_CHARACTER')
    return true
  })
})

test('invalid character shapes are rejected', () => {
  const registry = new CharacterRegistry()
  assert.throws(() => registry.register(null), (error) => error.code === 'INVALID_CHARACTER')
  assert.throws(() => registry.register({ id: 'BAD ID', name: 'x' }), (error) => error.code === 'INVALID_CHARACTER_ID')
  assert.throws(() => registry.register({ id: 'valid-id', name: '  ' }), (error) => error.code === 'INVALID_CHARACTER_NAME')
})

test('list/get return copies so callers cannot mutate the registry', () => {
  const registry = new CharacterRegistry()
  registry.register(character('chie'))
  const listed = registry.list()
  listed[0].name = 'mutated'
  assert.equal(registry.get('chie').name, 'chie')
})
