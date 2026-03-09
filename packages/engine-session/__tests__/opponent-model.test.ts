import { describe, it, expect } from 'vitest';
import { createOpponentModel, updateOpponentModel } from '../src/round/opponent-model.js';
import type { OpponentMove } from '../src/round/types.js';

describe('createOpponentModel', () => {
  it('creates a fresh model with zero state', () => {
    const model = createOpponentModel();
    expect(model.concession_rate).toBe(0);
    expect(model.move_count).toBe(0);
    expect(model.last_move).toBeNull();
  });
});

describe('updateOpponentModel', () => {
  it('sets rate directly on first observation (CONCESSION)', () => {
    const model = createOpponentModel();
    const move: OpponentMove = { type: 'CONCESSION', magnitude: 0.2 };
    const updated = updateOpponentModel(model, move);
    expect(updated.concession_rate).toBeCloseTo(0.2, 6);
    expect(updated.move_count).toBe(1);
    expect(updated.last_move).toBe(move);
  });

  it('sets negative rate for first SELFISH move', () => {
    const model = createOpponentModel();
    const move: OpponentMove = { type: 'SELFISH', magnitude: 0.15 };
    const updated = updateOpponentModel(model, move);
    expect(updated.concession_rate).toBeCloseTo(-0.15, 6);
    expect(updated.move_count).toBe(1);
  });

  it('sets zero rate for first SILENT move', () => {
    const model = createOpponentModel();
    const move: OpponentMove = { type: 'SILENT', magnitude: 0 };
    const updated = updateOpponentModel(model, move);
    expect(updated.concession_rate).toBe(0);
    expect(updated.move_count).toBe(1);
  });

  it('applies EMA smoothing on subsequent observations', () => {
    let model = createOpponentModel();
    const first: OpponentMove = { type: 'CONCESSION', magnitude: 0.5 };
    model = updateOpponentModel(model, first);
    // rate = 0.5

    const second: OpponentMove = { type: 'CONCESSION', magnitude: 0.3 };
    model = updateOpponentModel(model, second, 0.3);
    // EMA: 0.3 * 0.3 + 0.7 * 0.5 = 0.09 + 0.35 = 0.44
    expect(model.concession_rate).toBeCloseTo(0.44, 6);
    expect(model.move_count).toBe(2);
  });

  it('decreases rate when opponent becomes selfish', () => {
    let model = createOpponentModel();
    model = updateOpponentModel(model, { type: 'CONCESSION', magnitude: 0.5 });
    // rate = 0.5

    model = updateOpponentModel(model, { type: 'SELFISH', magnitude: 0.4 }, 0.3);
    // EMA: 0.3 * (-0.4) + 0.7 * 0.5 = -0.12 + 0.35 = 0.23
    expect(model.concession_rate).toBeCloseTo(0.23, 6);
  });

  it('does not mutate the input model', () => {
    const model = createOpponentModel();
    const move: OpponentMove = { type: 'CONCESSION', magnitude: 0.3 };
    const updated = updateOpponentModel(model, move);
    expect(model.move_count).toBe(0);
    expect(model.concession_rate).toBe(0);
    expect(updated).not.toBe(model);
  });

  it('tracks move history through last_move', () => {
    let model = createOpponentModel();
    const m1: OpponentMove = { type: 'CONCESSION', magnitude: 0.2 };
    const m2: OpponentMove = { type: 'SILENT', magnitude: 0 };
    model = updateOpponentModel(model, m1);
    expect(model.last_move).toBe(m1);
    model = updateOpponentModel(model, m2);
    expect(model.last_move).toBe(m2);
  });

  it('allows custom EMA alpha', () => {
    let model = createOpponentModel();
    model = updateOpponentModel(model, { type: 'CONCESSION', magnitude: 1.0 });
    // rate = 1.0
    model = updateOpponentModel(model, { type: 'CONCESSION', magnitude: 0.0 }, 0.5);
    // EMA: 0.5 * 0 + 0.5 * 1.0 = 0.5
    expect(model.concession_rate).toBeCloseTo(0.5, 6);
  });
});
