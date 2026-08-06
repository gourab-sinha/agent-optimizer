import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

// Temporarily patch REC_TYPES shapes is hard; instead exercise via known types.
// Invalid range specs are only hit if payloadShape is malformed - covered if we
// call validatePayloadShape through a custom rec type is not possible without
// mutating REC_TYPES.

import db from '../../../src/db/connection.js';
import { REC_TYPES } from '../../../src/recommend/recTypes.js';
import { validateAndInsert } from '../../../src/recommend/validate.js';

describe('validate range edge cases via temporary REC_TYPES mutation', () => {
  const patternId = 'p1';
  const criterionId = 'c1';

  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('issue_patterns')) return { rows: [{ id: patternId }] };
      if (sql.includes('rubric_criteria')) return { rows: [{ id: criterionId }] };
      if (sql.includes('test_cases')) return { rows: [] };
      return { rows: [] };
    });
  });

  it('rejects invalid int and float range specs and unknown enums', async () => {
    REC_TYPES.__test_int = {
      tier: 'applicable',
      payloadShape: { n: 'int:bad' },
      apply: (c, a) => ({ config: c, actions: a }),
    };
    REC_TYPES.__test_float = {
      tier: 'applicable',
      payloadShape: { n: 'float:bad' },
      apply: (c, a) => ({ config: c, actions: a }),
    };
    REC_TYPES.__test_enum = {
      tier: 'applicable',
      payloadShape: { n: 'enum:UNKNOWN_ENUM' },
      apply: (c, a) => ({ config: c, actions: a }),
    };

    const base = {
      rationale: 'r',
      linkedPatternIds: [patternId],
      expectedCriterionIds: [criterionId],
      supportingTestCaseIds: [],
    };

    let r = await validateAndInsert(
      [{ ...base, recType: '__test_int', payload: { n: 1 } }],
      'av',
      { prompt: 'p', actions: [] }
    );
    expect(r.rejected[0].reason).toMatch(/Invalid int range/);

    r = await validateAndInsert(
      [{ ...base, recType: '__test_float', payload: { n: 0.5 } }],
      'av',
      { prompt: 'p', actions: [] }
    );
    expect(r.rejected[0].reason).toMatch(/Invalid float range/);

    r = await validateAndInsert(
      [{ ...base, recType: '__test_enum', payload: { n: 'x' } }],
      'av',
      { prompt: 'p', actions: [] }
    );
    expect(r.rejected[0].reason).toMatch(/Unknown enum/);

    delete REC_TYPES.__test_int;
    delete REC_TYPES.__test_float;
    delete REC_TYPES.__test_enum;
  });
});
