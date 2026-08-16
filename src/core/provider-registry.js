/**
 * ProviderRegistry — the reusable seam shape for LiveAI Talk capabilities.
 *
 * One registry instance owns one capability namespace (`asr`, `tts`,
 * `avatar-media`, ...). Provider selection deliberately does not depend on
 * registration order:
 *   - explicit id must be registered and available;
 *   - `auto` resolves when exactly one registered provider is available;
 *   - `auto` with multiple usable providers fails AMBIGUOUS instead of
 *     silently picking the first one (same stance as the dsh web seam).
 */

const CAPABILITY_ID = /^[a-z][a-z0-9-]{1,63}$/

export class ProviderRegistryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProviderRegistryError'
    this.code = code
  }
}

export class ProviderRegistry {
  constructor(capability) {
    if (typeof capability !== 'string' || !CAPABILITY_ID.test(capability)) {
      throw new ProviderRegistryError('INVALID_CAPABILITY', `capability must match ${CAPABILITY_ID}`)
    }
    this.capability = capability
    this.providers = new Map()
  }

  register(provider) {
    if (typeof provider !== 'object' || provider === null) {
      throw new ProviderRegistryError('INVALID_PROVIDER', 'provider must be an object')
    }
    if (typeof provider.id !== 'string' || !CAPABILITY_ID.test(provider.id)) {
      throw new ProviderRegistryError('INVALID_PROVIDER_ID', `provider id must match ${CAPABILITY_ID}`)
    }
    if (provider.capability !== this.capability) {
      throw new ProviderRegistryError(
        'CAPABILITY_MISMATCH',
        `provider capability "${provider.capability}" does not match "${this.capability}"`,
      )
    }
    if (this.providers.has(provider.id)) {
      throw new ProviderRegistryError('DUPLICATE_PROVIDER', `provider "${provider.id}" is already registered for ${this.capability}`)
    }
    this.providers.set(provider.id, provider)
    return () => {
      this.providers.delete(provider.id)
    }
  }

  list() {
    return [...this.providers.values()]
  }

  available() {
    return this.list().filter((provider) => provider.available?.() !== false)
  }

  /**
   * Resolve the provider that should serve a request. `requestedId` is either
   * an explicit provider id or `auto`.
   */
  resolve(requestedId = 'auto') {
    if (typeof requestedId !== 'string' || requestedId === '') {
      throw new ProviderRegistryError('INVALID_PROVIDER_SELECTION', 'provider selection must be a non-empty string')
    }
    if (requestedId !== 'auto') {
      const provider = this.providers.get(requestedId)
      if (!provider) {
        throw new ProviderRegistryError('PROVIDER_CONFIGURED_MISSING', `configured provider "${requestedId}" is not registered for ${this.capability}`)
      }
      if (provider.available?.() === false) {
        throw new ProviderRegistryError('PROVIDER_CONFIGURED_UNAVAILABLE', `configured provider "${requestedId}" is unavailable`)
      }
      return provider
    }
    const usable = this.available()
    if (usable.length === 0) {
      throw new ProviderRegistryError('PROVIDER_UNAVAILABLE', `no available provider for ${this.capability}`)
    }
    if (usable.length > 1) {
      throw new ProviderRegistryError(
        'PROVIDER_AMBIGUOUS',
        `multiple available providers for ${this.capability}: ${usable.map((provider) => provider.id).join(', ')}`,
      )
    }
    return usable[0]
  }
}
