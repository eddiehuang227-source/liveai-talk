/**
 * CharacterRegistry — the character seam for LiveAI Talk.
 *
 * Service Definition (this package), Provider = built-in manifests or a future
 * character-pack plugin, Consumer = the dsh client avatar view and the
 * dialogue/video pipeline.
 */

const CHARACTER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export class CharacterRegistryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CharacterRegistryError'
    this.code = code
  }
}

function validateCharacter(character) {
  if (typeof character !== 'object' || character === null) {
    throw new CharacterRegistryError('INVALID_CHARACTER', 'character must be an object')
  }
  if (typeof character.id !== 'string' || !CHARACTER_ID.test(character.id)) {
    throw new CharacterRegistryError(
      'INVALID_CHARACTER_ID',
      `character id must match ${CHARACTER_ID}`,
    )
  }
  if (typeof character.name !== 'string' || !character.name.trim()) {
    throw new CharacterRegistryError('INVALID_CHARACTER_NAME', 'character name must be a non-empty string')
  }
}

/**
 * Owns the set of registered characters. Registration is scoped to the calling
 * fiber through the disposer returned from {@link register}; duplicate ids
 * fail loud instead of silently replacing an entry.
 */
export class CharacterRegistry {
  constructor() {
    this.characters = new Map()
  }

  register(character) {
    validateCharacter(character)
    if (this.characters.has(character.id)) {
      throw new CharacterRegistryError('DUPLICATE_CHARACTER', `character "${character.id}" is already registered`)
    }
    this.characters.set(character.id, character)
    return () => {
      this.characters.delete(character.id)
    }
  }

  has(id) {
    return this.characters.has(id)
  }

  get(id) {
    const character = this.characters.get(id)
    return character ? { ...character } : null
  }

  list() {
    return [...this.characters.values()].map((character) => ({ ...character }))
  }
}
