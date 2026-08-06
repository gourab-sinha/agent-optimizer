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

vi.mock('../../../src/services/llmService.js', () => ({
  callLLM: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import { callLLM } from '../../../src/services/llmService.js';
import {
  generateRubricForAgentVersion,
  evaluateCall,
  getRubricByAgentVersion,
} from '../../../src/services/rubricEvaluationService.js';

function makeCriteria(count = 6) {
  const categories = ['data_collection', 'flow', 'tone', 'objection', 'compliance', 'tools'];
  return Array.from({ length: count }, (_, i) => ({
    key: `crit_${i}`,
    category: categories[i % categories.length],
    description: `Criterion ${i}`,
    checkType: i % 2 === 0 ? 'deterministic' : 'llm',
    checkSpec:
      i % 2 === 0
        ? i === 0
          ? { kind: 'action_executed', actionName: 'book' }
          : i === 2
            ? { kind: 'extracted_field', field: 'email' }
            : i === 4
              ? { kind: 'agent_said_any', phrases: ['hello'] }
              : { kind: 'duration_between', minSeconds: 10, maxSeconds: 600 }
        : { kind: 'llm', question: 'Was tone good?' },
    severity: (i % 3) + 1,
    enabled: true,
  }));
}

describe('services/rubricEvaluationService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('generateRubricForAgentVersion', () => {
    it('throws when version missing', async () => {
      db.query.mockResolvedValue({ rows: [] });
      await expect(generateRubricForAgentVersion('x')).rejects.toThrow('not found');
    });

    it('throws on invalid LLM JSON', async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 'av', agent_id: 'a', config: { prompt: 'P' }, actions: [] }],
        })
        .mockResolvedValueOnce({ rows: [] }); // sample calls
      callLLM.mockResolvedValue({ content: 'not-json' });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'Failed to parse LLM rubric response'
      );
    });

    it('throws when criteria count out of range', async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 'av', agent_id: 'a', config: { prompt: 'P' }, actions: [] }],
        })
        .mockResolvedValueOnce({ rows: [] });
      callLLM.mockResolvedValue({
        content: JSON.stringify({ criteria: makeCriteria(2) }),
      });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        '6-14 criteria'
      );
    });

    it('returns cached rubric when content hash matches', async () => {
      const criteria = makeCriteria(6);
      db.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'av',
              agent_id: 'a',
              config: { prompt: 'P', model: 'm', temperature: 0.2 },
              actions: [{ name: 'Book' }],
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'c1',
              summary: 's',
              duration_s: 60,
              executed_actions: [{ name: 'book' }],
              extracted_data: { email: 'a@b.com' },
              turns: [{ idx: 0, speaker: 'agent', text: 'hello' }],
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: 'existing-rubric' }] });

      callLLM.mockResolvedValue({
        content: JSON.stringify({ criteria }),
      });

      const result = await generateRubricForAgentVersion('av');
      expect(result.cached).toBe(true);
      expect(result.rubricId).toBe('existing-rubric');
    });

    it('inserts new rubric and criteria', async () => {
      const criteria = makeCriteria(6);
      // add more kinds for validation coverage via generation path
      criteria[1].checkType = 'deterministic';
      criteria[1].checkSpec = { kind: 'action_not_executed', actionName: 'transfer' };
      criteria[3].checkType = 'deterministic';
      criteria[3].checkSpec = {
        kind: 'agent_said_none',
        forbiddenPhrases: ['um'],
      };

      db.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'av',
              agent_id: 'a',
              config: { prompt: 'P' },
              actions: 'not-array',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // samples
        .mockResolvedValueOnce({ rows: [] }) // existing hash miss
        .mockResolvedValueOnce({ rows: [{ max_version: 0 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'rubric-new' }] }); // insert rubric

      callLLM.mockResolvedValue({
        content: JSON.stringify({ criteria }),
      });

      // remaining inserts for criteria
      db.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await generateRubricForAgentVersion('av');
      expect(result.cached).toBe(false);
      expect(result.criteriaCount).toBe(6);
    });

    it('validates criterion fields thoroughly via generate path', async () => {
      const setupVersion = () => {
        db.query
          .mockResolvedValueOnce({
            rows: [{ id: 'av', agent_id: 'a', config: {}, actions: [] }],
          })
          .mockResolvedValueOnce({ rows: [] }); // sample calls
      };

      setupVersion();
      const bad = makeCriteria(6);
      bad[0].key = bad[1].key; // duplicate
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: bad }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow('Duplicate');

      setupVersion();
      const badCat = makeCriteria(6);
      badCat[0].category = 'nope';
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: badCat }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow('Invalid category');

      setupVersion();
      const badType = makeCriteria(6);
      badType[0].checkType = 'nope';
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: badType }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow('Invalid checkType');

      setupVersion();
      const badSev = makeCriteria(6);
      badSev[0].severity = 9;
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: badSev }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow('Invalid severity');
    });
  });

  describe('evaluateCall', () => {
    it('throws when call missing', async () => {
      db.query.mockResolvedValue({ rows: [] });
      await expect(evaluateCall('c1', 'r1')).rejects.toThrow('not found');
    });

    it('returns 0 findings when no criteria', async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'c1',
              duration_s: 100,
              executed_actions: [],
              extracted_data: {},
              turns: [],
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });
      const r = await evaluateCall('c1', 'r1');
      expect(r.findingsCreated).toBe(0);
    });

    it('evaluates deterministic and llm criteria', async () => {
      callLLM.mockResolvedValue({
        content: JSON.stringify({
          answer: 'yes',
          confidence: 0.9,
          reasoning: 'Good',
          evidenceTurnIndices: [0],
        }),
      });

      const callRow = {
        id: 'c1',
        duration_s: 100,
        executed_actions: [{ name: 'book' }, { action: 'send' }],
        extracted_data: { email: 'a@b.com' },
        turns: [
          { id: 't0', idx: 0, speaker: 'agent', text: 'Hello there' },
          { id: 't1', idx: 1, speaker: 'caller', text: 'Hi' },
        ],
      };

      const criteria = [
        {
          id: 'cr1',
          key: 'booked',
          check_type: 'deterministic',
          check_spec: { kind: 'action_executed', actionName: 'book' },
        },
        {
          id: 'cr2',
          key: 'no_transfer',
          check_type: 'deterministic',
          check_spec: { kind: 'action_not_executed', actionName: 'transfer' },
        },
        {
          id: 'cr3',
          key: 'has_email',
          check_type: 'deterministic',
          check_spec: { kind: 'extracted_field', field: 'email', required: true },
        },
        {
          id: 'cr4',
          key: 'opt_email',
          check_type: 'deterministic',
          check_spec: { kind: 'extracted_field', field: 'phone', required: false },
        },
        {
          id: 'cr5',
          key: 'said_hello',
          check_type: 'deterministic',
          check_spec: { kind: 'agent_said_any', phrases: ['hello'] },
        },
        {
          id: 'cr6',
          key: 'no_um',
          check_type: 'deterministic',
          check_spec: { kind: 'agent_said_none', forbiddenPhrases: ['um'] },
        },
        {
          id: 'cr7',
          key: 'duration',
          check_type: 'deterministic',
          check_spec: { kind: 'duration_between', minSeconds: 10, maxSeconds: 200 },
        },
        {
          id: 'cr8',
          key: 'tone',
          check_type: 'llm',
          check_spec: { kind: 'llm', question: 'Good tone?' },
          description: 'Tone',
        },
      ];

      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM calls c')) return { rows: [callRow] };
        if (sql.includes('FROM rubric_criteria')) return { rows: criteria };
        if (sql.includes('INSERT INTO findings')) return { rows: [], rowCount: 1 };
        return { rows: [] };
      });

      const result = await evaluateCall('c1', 'r1');
      expect(result.findingsCreated).toBe(criteria.length);
    });

    it('handles llm parse failure and no answer', async () => {
      callLLM
        .mockResolvedValueOnce({ content: 'bad' })
        .mockResolvedValueOnce({
          content: JSON.stringify({ answer: 'maybe', confidence: 2 }),
        });

      const callRow = {
        id: 'c1',
        duration_s: 1,
        executed_actions: [{ name: 'x', parameters: { a: 1 } }],
        extracted_data: { k: 'v' },
        turns: [{ id: 't0', idx: 0, speaker: 'agent', text: 'um hello' }],
      };

      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM calls c')) return { rows: [callRow] };
        if (sql.includes('FROM rubric_criteria')) {
          return {
            rows: [
              {
                id: '1',
                key: 't',
                check_type: 'llm',
                check_spec: { kind: 'llm', question: 'Q?' },
                description: 'd',
              },
              {
                id: '2',
                key: 't2',
                check_type: 'llm',
                check_spec: { kind: 'llm', question: 'Q2?' },
                description: 'd',
              },
              {
                id: '3',
                key: 'forbid',
                check_type: 'deterministic',
                check_spec: {
                  kind: 'agent_said_none',
                  forbiddenPhrases: ['um'],
                },
              },
              {
                id: '4',
                key: 'miss_action',
                check_type: 'deterministic',
                check_spec: { kind: 'action_executed', actionName: 'missing' },
              },
              {
                id: '5',
                key: 'miss_phrase',
                check_type: 'deterministic',
                check_spec: { kind: 'agent_said_any', phrases: ['goodbye'] },
              },
              {
                id: '6',
                key: 'dur_fail',
                check_type: 'deterministic',
                check_spec: { kind: 'duration_between', minSeconds: 100, maxSeconds: 200 },
              },
            ],
          };
        }
        return { rows: [] };
      });

      const result = await evaluateCall('c1', 'r1');
      expect(result.findingsCreated).toBe(6);
    });
  });

  describe('getRubricByAgentVersion', () => {
    it('returns null or rubric', async () => {
      db.query.mockResolvedValue({ rows: [] });
      expect(await getRubricByAgentVersion('av')).toBeNull();
      db.query.mockResolvedValue({ rows: [{ id: 'r1', criteria: [] }] });
      expect(await getRubricByAgentVersion('av')).toEqual({
        id: 'r1',
        criteria: [],
      });
    });
  });

  describe('validateRubricData edge cases via generate', () => {
    const setup = () => {
      db.query
        .mockResolvedValueOnce({
          rows: [{ id: 'av', agent_id: 'a', config: { prompt: 'p' }, actions: [] }],
        })
        .mockResolvedValueOnce({ rows: [] });
    };

    it('rejects missing required criterion fields', async () => {
      setup();
      callLLM.mockResolvedValue({
        content: JSON.stringify({
          criteria: makeCriteria(6).map((c, i) =>
            i === 0 ? { ...c, description: undefined } : c
          ),
        }),
      });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'missing "description"'
      );
    });

    it('rejects invalid deterministic kind and missing fields', async () => {
      setup();
      const c = makeCriteria(6);
      c[0].checkType = 'deterministic';
      c[0].checkSpec = { kind: 'unknown_kind' };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'Invalid deterministic kind'
      );

      setup();
      const c2 = makeCriteria(6);
      c2[0].checkType = 'deterministic';
      c2[0].checkSpec = { kind: 'action_executed' };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c2 }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'missing actionName'
      );

      setup();
      const c3 = makeCriteria(6);
      c3[0].checkType = 'deterministic';
      c3[0].checkSpec = { kind: 'extracted_field' };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c3 }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'missing field'
      );

      setup();
      const c4 = makeCriteria(6);
      c4[0].checkType = 'deterministic';
      c4[0].checkSpec = { kind: 'agent_said_any', phrases: [] };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c4 }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'missing phrases'
      );

      setup();
      const c5 = makeCriteria(6);
      c5[0].checkType = 'deterministic';
      c5[0].checkSpec = { kind: 'agent_said_none', forbiddenPhrases: [] };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c5 }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'missing forbiddenPhrases'
      );

      setup();
      const c6 = makeCriteria(6);
      c6[0].checkType = 'deterministic';
      c6[0].checkSpec = { kind: 'duration_between' };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c6 }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'duration_between'
      );

      setup();
      const c7 = makeCriteria(6);
      c7[1].checkType = 'llm';
      c7[1].checkSpec = { kind: 'not_llm', question: 'q' };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c7 }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'checkSpec.kind is not "llm"'
      );

      setup();
      const c8 = makeCriteria(6);
      c8[1].checkType = 'llm';
      c8[1].checkSpec = { kind: 'llm' };
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: c8 }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'missing question'
      );

      setup();
      callLLM.mockResolvedValue({ content: JSON.stringify({ criteria: null }) });
      await expect(generateRubricForAgentVersion('av')).rejects.toThrow(
        'criteria'
      );
    });

    it('throws on unknown deterministic kind at evaluation time', async () => {
      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM calls c')) {
          return {
            rows: [
              {
                id: 'c1',
                duration_s: 1,
                executed_actions: [],
                extracted_data: {},
                turns: [],
              },
            ],
          };
        }
        if (sql.includes('FROM rubric_criteria')) {
          return {
            rows: [
              {
                id: '1',
                key: 'x',
                check_type: 'deterministic',
                check_spec: { kind: 'totally_unknown' },
              },
            ],
          };
        }
        return { rows: [] };
      });
      await expect(evaluateCall('c1', 'r1')).rejects.toThrow(
        'Unknown deterministic kind'
      );
    });

    it('throws on unknown check_type at evaluation time', async () => {
      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM calls c')) {
          return {
            rows: [
              {
                id: 'c1',
                duration_s: 1,
                executed_actions: [],
                extracted_data: {},
                turns: [],
              },
            ],
          };
        }
        if (sql.includes('FROM rubric_criteria')) {
          return {
            rows: [
              {
                id: '1',
                key: 'x',
                check_type: 'mystery',
                check_spec: { kind: 'x' },
              },
            ],
          };
        }
        return { rows: [] };
      });
      await expect(evaluateCall('c1', 'r1')).rejects.toThrow('Unknown check_type');
    });
  });
});

