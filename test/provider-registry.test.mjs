import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderRegistry, ProviderRegistryError } from '../lib/core/provider-registry.js'

function provider(id, capability, available = true) {
  return { id, capability, available: () => available }
}

test('register is scoped to its capability namespace and reversible', () => {
  const registry = new ProviderRegistry('tts')
  const dispose = registry.register(provider('doubao', 'tts'))
  assert.equal(registry.list().length, 1)
  assert.equal(registry.available().length, 1)
  dispose()
  assert.equal(registry.list().length, 0)
})

test('duplicate ids and capability mismatches fail loud', () => {
  const registry = new ProviderRegistry('tts')
  registry.register(provider('doubao', 'tts'))
  assert.throws(() => registry.register(provider('doubao', 'tts')), (error) => {
    assert.equal(error.code, 'DUPLICATE_PROVIDER')
    return true
  })
  assert.throws(() => registry.register(provider('elevenlabs', 'asr')), (error) => {
    assert.equal(error.code, 'CAPABILITY_MISMATCH')
    return true
  })
})

test('explicit selection requires a registered and available provider', () => {
  const registry = new ProviderRegistry('asr')
  registry.register(provider('sensevoice', 'asr', false))
  assert.throws(() => registry.resolve('missing'), (error) => error.code === 'PROVIDER_CONFIGURED_MISSING')
  assert.throws(() => registry.resolve('sensevoice'), (error) => error.code === 'PROVIDER_CONFIGURED_UNAVAILABLE')
  registry.register(provider('doubao', 'asr'))
  assert.equal(registry.resolve('doubao').id, 'doubao')
})

test('auto selection never depends on registration order and rejects ambiguity', () => {
  const single = new ProviderRegistry('asr')
  single.register(provider('sensevoice', 'asr'))
  single.register(provider('doubao', 'asr', false))
  assert.equal(single.resolve('auto').id, 'sensevoice')

  const ambiguous = new ProviderRegistry('tts')
  ambiguous.register(provider('doubao', 'tts'))
  ambiguous.register(provider('edge', 'tts'))
  assert.throws(() => ambiguous.resolve('auto'), (error) => {
    assert.ok(error instanceof ProviderRegistryError)
    assert.equal(error.code, 'PROVIDER_AMBIGUOUS')
    return true
  })

  const empty = new ProviderRegistry('avatar-media')
  assert.throws(() => empty.resolve('auto'), (error) => {
    assert.equal(error.code, 'PROVIDER_UNAVAILABLE')
    return true
  })
})
