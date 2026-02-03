import { describe, it, expect } from 'vitest'
import { validatePolicyDocument, isPolicyDocumentValid } from './validator.js'

describe('PolicyValidator', () => {
  describe('validatePolicyDocument', () => {
    it('should validate a valid policy document', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test-rule',
            priority: 100,
            match: {
              resource: 'tool',
              action: 'read',
            },
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors).toHaveLength(0)
    })

    it('should error on missing version', () => {
      const doc = {
        rules: [],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.field === 'version')).toBe(true)
    })

    it('should error on missing rules array', () => {
      const doc = {
        version: '1.0',
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.field === 'rules')).toBe(true)
    })

    it('should error on invalid rules type', () => {
      const doc = {
        version: '1.0',
        rules: 'not-an-array',
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.field === 'rules')).toBe(true)
    })

    it('should detect duplicate rule IDs', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'duplicate',
            priority: 100,
            match: {},
            effect: 'allow',
          },
          {
            id: 'duplicate',
            priority: 200,
            match: {},
            effect: 'deny',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('Duplicate rule ID'))).toBe(true)
    })
  })

  describe('validatePolicyRule', () => {
    it('should error on missing rule id', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            priority: 100,
            match: {},
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('id'))).toBe(true)
    })

    it('should error on missing priority', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            match: {},
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('priority'))).toBe(true)
    })

    it('should error on missing match', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('match'))).toBe(true)
    })

    it('should error on invalid effect', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            match: {},
            effect: 'invalid',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('effect'))).toBe(true)
    })

    it('should error on invalid resource type', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            match: {
              resource: 'invalid-resource',
            },
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('Invalid resource type'))).toBe(true)
    })

    it('should error on invalid action type', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            match: {
              action: 'invalid-action',
            },
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('Invalid action type'))).toBe(true)
    })

    it('should validate array of resource types', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            match: {
              resource: ['tool', 'channel'],
              action: ['read', 'write'],
            },
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors).toHaveLength(0)
    })

    it('should error on invalid condition operator', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            match: {},
            conditions: [
              {
                field: 'test',
                operator: 'invalid',
                value: 'test',
              },
            ],
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('valid operator'))).toBe(true)
    })

    it('should error on missing condition field', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            match: {},
            conditions: [
              {
                operator: 'equals',
                value: 'test',
              },
            ],
            effect: 'allow',
          },
        ],
      }

      const errors = validatePolicyDocument(doc, 'test.yaml')
      expect(errors.some((e) => e.message.includes('field'))).toBe(true)
    })
  })

  describe('isPolicyDocumentValid', () => {
    it('should return true for valid document', () => {
      const doc = {
        version: '1.0',
        rules: [
          {
            id: 'test',
            priority: 100,
            match: {},
            effect: 'allow',
          },
        ],
      }

      expect(isPolicyDocumentValid(doc, 'test.yaml')).toBe(true)
    })

    it('should return false for invalid document', () => {
      const doc = {
        version: '1.0',
        rules: 'invalid',
      }

      expect(isPolicyDocumentValid(doc, 'test.yaml')).toBe(false)
    })
  })
})
