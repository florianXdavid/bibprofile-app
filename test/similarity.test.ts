import { describe, it, expect } from 'vitest'
import { diceCoefficient } from '../src/lib/similarity'

describe('diceCoefficient', () => {
  it('is 1 for identical titles ignoring case/punctuation', () => {
    expect(diceCoefficient('The Hippocampus as a Cognitive Map', 'the hippocampus as a cognitive map!')).toBe(1)
  })
  it('is high for edition/case variants', () => {
    expect(diceCoefficient('Principles of Neural Science', 'Principles of Neural Science, 5th Edition')).toBeGreaterThan(0.7)
  })
  it('is low for unrelated titles', () => {
    expect(diceCoefficient('Toward an integration of deep learning and neuroscience', 'Deep learning')).toBeLessThan(0.5)
  })
})
