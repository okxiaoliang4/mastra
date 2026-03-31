import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema, ensureAllPropertiesRequired, stripJsonSchemaFields } from './zod-to-json';

/**
 * Shared test suite for zodToJsonSchema that runs with both Zod v3 and v4.
 * The caller passes the zod instance to use for the tests.
 *
 * @param z - The zod instance (either v3 or v4)
 */

// Detect if we're running with Zod v4 (v4 has _zod property on schema instances)
const isZodV4 = '_zod' in z.string();

/**
 * Creates a z.record() schema that works with both Zod v3 and v4.
 * - Zod v4: z.record(keyType, valueType) - requires both key and value types
 * - Zod v3: z.record(valueType) - only takes value type (keys are implicitly strings)
 *
 * @param valueType - The Zod type for record values
 * @returns A z.record() schema compatible with the current Zod version
 */
function createRecord<T extends z.ZodTypeAny>(valueType: T) {
  if (isZodV4) {
    return z.record(z.string(), valueType);
  }
  // @ts-expect-error - zod v3 does not support record with key and value types
  return z.record(valueType);
}

describe('zodToJsonSchema', () => {
  describe('z.record() compatibility', () => {
    it('should convert schema with z.record() fields', () => {
      const schema = z.object({
        name: z.string(),
        variables: createRecord(z.string()).optional(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('name');
      expect(result.properties).toHaveProperty('variables');
    });

    it('should handle nested z.record() in complex schemas', () => {
      const schema = z.object({
        dependencies: createRecord(z.string()).optional(),
        devDependencies: createRecord(z.string()).optional(),
        scripts: createRecord(z.string()).optional(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('dependencies');
      expect(result.properties).toHaveProperty('devDependencies');
      expect(result.properties).toHaveProperty('scripts');
    });

    it('should handle standalone z.record()', () => {
      const schema = createRecord(z.string());

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
    });

    it('should handle z.record() with complex value types', () => {
      const schema = createRecord(
        z.object({
          value: z.string(),
          count: z.number(),
        }),
      );

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
    });

    it('should produce valid JSON Schema output for z.record()', () => {
      const schema = z.object({
        metadata: createRecord(z.union([z.string(), z.number(), z.boolean()])),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('metadata');

      // Verify the record field has valid JSON Schema structure
      const metadataSchema = result.properties!.metadata as any;
      expect(metadataSchema).toBeDefined();
      expect(['object', 'additionalProperties', 'patternProperties'].some(key => key in metadataSchema)).toBe(true);
    });

    it('should handle z.record() with two arguments (key and value schemas)', () => {
      const schema = z.record(z.string(), z.number());

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result).toHaveProperty('additionalProperties');

      // Value type should be number
      const valueSchema = result.additionalProperties as any;
      expect(valueSchema.type).toBe('number');
    });

    it('should handle z.record() with enum keys and complex values', () => {
      const schema = z.record(
        z.enum(['admin', 'user', 'guest']),
        z.object({
          permissions: z.array(z.string()),
          level: z.number(),
        }),
      );

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
    });

    it('should handle z.record() with two args in optional fields', () => {
      const schema = z.object({
        scores: z.record(z.string(), z.number()).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('scores');
      expect(result.properties).toHaveProperty('metadata');
    });
  });

  describe('real-world failing schemas from agent-builder', () => {
    it('should convert AgentBuilderInputSchema', () => {
      // From packages/agent-builder/src/types.ts line 103-109
      const AgentBuilderInputSchema = z.object({
        repo: z.string().describe('Git URL or local path of the template repo'),
        ref: z.string().optional().describe('Tag/branch/commit to checkout (defaults to main/master)'),
        slug: z.string().optional().describe('Slug for branch/scripts; defaults to inferred from repo'),
        targetPath: z.string().optional().describe('Project path to merge into; defaults to current directory'),
        variables: createRecord(z.string()).optional().describe('Environment variables to set in .env file'),
      });

      const result = zodToJsonSchema(AgentBuilderInputSchema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('repo');
      expect(result.properties).toHaveProperty('variables');
      expect(result.required).toContain('repo');
    });

    it('should convert PackageAnalysisSchema', () => {
      // From packages/agent-builder/src/types.ts line 248-258
      const PackageAnalysisSchema = z.object({
        name: z.string().optional(),
        version: z.string().optional(),
        description: z.string().optional(),
        dependencies: createRecord(z.string()).optional(),
        devDependencies: createRecord(z.string()).optional(),
        peerDependencies: createRecord(z.string()).optional(),
        scripts: createRecord(z.string()).optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
      });

      const result = zodToJsonSchema(PackageAnalysisSchema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('dependencies');
      expect(result.properties).toHaveProperty('devDependencies');
      expect(result.properties).toHaveProperty('peerDependencies');
      expect(result.properties).toHaveProperty('scripts');
    });

    it('should convert PackageMergeInputSchema with nested PackageAnalysisSchema', () => {
      // From packages/agent-builder/src/types.ts line 275-280
      const PackageAnalysisSchema = z.object({
        name: z.string().optional(),
        dependencies: createRecord(z.string()).optional(),
        devDependencies: createRecord(z.string()).optional(),
      });

      const PackageMergeInputSchema = z.object({
        commitSha: z.string(),
        slug: z.string(),
        targetPath: z.string().optional(),
        packageInfo: PackageAnalysisSchema,
      });

      const result = zodToJsonSchema(PackageMergeInputSchema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('packageInfo');
      expect(result.required).toContain('commitSha');
      expect(result.required).toContain('slug');
      expect(result.required).toContain('packageInfo');
    });

    it('should convert FileCopyInputSchema', () => {
      // From packages/agent-builder/src/types.ts line 138-145
      const TemplateUnitSchema = z.object({
        kind: z.enum(['mcp-server', 'tool', 'workflow', 'agent', 'integration', 'network', 'other']),
        id: z.string(),
        file: z.string(),
      });

      const FileCopyInputSchema = z.object({
        orderedUnits: z.array(TemplateUnitSchema),
        templateDir: z.string(),
        commitSha: z.string(),
        slug: z.string(),
        targetPath: z.string().optional(),
        variables: createRecord(z.string()).optional(),
      });

      const result = zodToJsonSchema(FileCopyInputSchema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('orderedUnits');
      expect(result.properties).toHaveProperty('variables');
      expect(result.required).toContain('orderedUnits');
    });
  });

  describe('edge cases', () => {
    it('should handle nested z.record() (record of records)', () => {
      const schema = z.record(createRecord(z.string()));

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
    });

    it('should handle z.record() in array', () => {
      const schema = z.array(createRecord(z.string()));

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('array');
      expect(result.items).toBeDefined();
    });

    it('should handle z.record() in union', () => {
      const schema = z.union([z.string(), createRecord(z.string())]);

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      // Union could be represented as anyOf or oneOf
      expect(result.anyOf || result.oneOf).toBeDefined();
    });

    it('should handle empty object with potential for records', () => {
      const schema = z.object({
        data: createRecord(z.any()).optional(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
    });

    it('should handle z.record() with .nullable()', () => {
      const schema = z.object({
        config: createRecord(z.string()).nullable(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('config');
    });

    it('should handle z.record() with .default()', () => {
      const schema = z.object({
        settings: createRecord(z.string()).default({}),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('settings');
    });

    it('should handle mixed one-arg and two-arg records in same schema', () => {
      const schema = z.object({
        // One-arg form (string values)
        metadata: createRecord(z.string()),
        // Two-arg form (number values with explicit string keys)
        scores: z.record(z.string(), z.number()),
        // Two-arg with enum keys
        roles: z.record(z.enum(['admin', 'user']), z.boolean()).optional(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('metadata');
      expect(result.properties).toHaveProperty('scores');
      expect(result.properties).toHaveProperty('roles');
    });

    it('should handle z.record() with .nullish()', () => {
      const schema = z.object({
        extra: createRecord(z.string()).nullish(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('extra');
    });

    it('should handle z.record() with .catch()', () => {
      const schema = z.object({
        config: createRecord(z.string()).catch({}),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('config');
    });

    it('should handle z.record() with date values', () => {
      const schema = z.object({
        timestamps: createRecord(z.date()),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('timestamps');

      // The record's values should be dates (converted to string with date-time format)
      const timestampsSchema = result.properties!.timestamps as any;
      expect(timestampsSchema).toBeDefined();

      // Verify the additionalProperties (record values) are properly typed as date-time strings
      const additionalProps = timestampsSchema.additionalProperties as any;
      expect(additionalProps).toBeDefined();
      expect(additionalProps.type).toBe('string');
      expect(additionalProps.format).toBe('date-time');
    });

    it('should handle deeply nested optional records', () => {
      const schema = z.object({
        level1: z
          .object({
            level2: z
              .object({
                level3: z
                  .object({
                    data: createRecord(z.string()).optional(),
                  })
                  .optional(),
              })
              .optional(),
          })
          .optional(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('level1');
    });

    it('should handle z.record() with .describe()', () => {
      const schema = z.object({
        metadata: createRecord(z.string()).describe('User metadata fields'),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('metadata');
    });

    it('should handle z.record() with literal union values', () => {
      const schema = createRecord(z.union([z.literal('active'), z.literal('inactive')]));

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
    });

    it('should handle intersection with z.record()', () => {
      const baseSchema = z.object({
        name: z.string(),
      });

      const extendedSchema = z.object({
        metadata: createRecord(z.string()),
      });

      const schema = z.intersection(baseSchema, extendedSchema);

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      // Intersection could be represented as allOf or merged object
      expect(result.allOf || result.type === 'object').toBeTruthy();
    });

    it('should handle lazy/recursive schemas with records', () => {
      const nodeSchema: any = z.lazy(() =>
        z.object({
          value: z.string(),
          children: createRecord(nodeSchema),
        }),
      );

      const result = zodToJsonSchema(nodeSchema);

      expect(result).toBeDefined();
      // Lazy schemas might use $ref or be inlined
      expect(result).toBeDefined();
    });
  });

  describe('date handling', () => {
    it('should convert z.date() to string with date-time format', () => {
      const schema = z.object({
        createdAt: z.date(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.properties?.createdAt).toMatchObject({
        type: 'string',
        format: 'date-time',
      });
    });

    it('should handle dates in schemas with z.record()', () => {
      const schema = z.object({
        createdAt: z.date(),
        metadata: createRecord(z.string()),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.properties?.createdAt).toMatchObject({
        type: 'string',
        format: 'date-time',
      });
      expect(result.properties).toHaveProperty('metadata');
    });
  });

  describe('basic schema types', () => {
    it('should handle simple object schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('name');
      expect(result.properties).toHaveProperty('age');
      expect(result.properties).toHaveProperty('active');
    });

    it('should handle optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.required).toContain('required');
      expect(result.required).not.toContain('optional');
    });

    it('should handle arrays', () => {
      const schema = z.array(z.string());

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('array');
      expect(result.items).toBeDefined();
    });

    it('should handle enums', () => {
      const schema = z.enum(['light', 'dark', 'auto']);

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.enum).toEqual(['light', 'dark', 'auto']);
    });
  });

  describe('different targets and strategies', () => {
    it('should handle openApi3 target', () => {
      const schema = z.object({
        name: z.string(),
        metadata: createRecord(z.string()),
      });

      const result = zodToJsonSchema(schema, 'openApi3');

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
    });

    it('should handle different strategy parameters', () => {
      const schema = z.object({
        data: createRecord(z.string()),
      });

      const resultNone = zodToJsonSchema(schema, 'jsonSchema7', 'none');
      const resultRoot = zodToJsonSchema(schema, 'jsonSchema7', 'root');

      expect(resultNone).toBeDefined();
      expect(resultRoot).toBeDefined();
    });
  });

  describe('fallback behavior', () => {
    it('should successfully convert schemas that might fail in Zod v4', () => {
      // This schema structure is known to cause issues in Zod v4's toJSONSchema
      const problematicSchema = z.object({
        repo: z.string(),
        variables: createRecord(z.string()).optional(),
        dependencies: createRecord(z.string()).optional(),
      });

      // Should not throw, even if v4 fails internally
      expect(() => zodToJsonSchema(problematicSchema)).not.toThrow();

      const result = zodToJsonSchema(problematicSchema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('repo');
      expect(result.properties).toHaveProperty('variables');
      expect(result.properties).toHaveProperty('dependencies');
    });

    it('should handle multiple z.record() fields without errors', () => {
      const schema = z.object({
        field1: createRecord(z.string()),
        field2: createRecord(z.number()),
        field3: createRecord(z.boolean()),
        field4: createRecord(z.any()),
      });

      expect(() => zodToJsonSchema(schema)).not.toThrow();

      const result = zodToJsonSchema(schema);

      expect(result).toBeDefined();
      expect(result.type).toBe('object');
      expect(Object.keys(result.properties || {}).length).toBe(4);
    });
  });
});

// =============================================================================
// ensureAllPropertiesRequired — unit tests
// =============================================================================

describe('ensureAllPropertiesRequired', () => {
  it('should add all properties to required array for object schemas', () => {
    const schema = zodToJsonSchema(
      z.object({
        isComplete: z.boolean(),
        completionReason: z.string(),
        finalResult: z.string().optional(),
      }),
    );

    // Before fix: finalResult should be in properties but NOT in required
    expect(schema.properties).toHaveProperty('finalResult');
    expect(schema.required).not.toContain('finalResult');

    const fixed = ensureAllPropertiesRequired(schema);

    // After fix: ALL properties should be in required
    expect(fixed.required).toContain('isComplete');
    expect(fixed.required).toContain('completionReason');
    expect(fixed.required).toContain('finalResult');
  });

  it('should handle the defaultCompletionSchema pattern', () => {
    const defaultCompletionSchema = z.object({
      isComplete: z.boolean().describe('Whether the task is complete'),
      completionReason: z.string().describe('Explanation of why the task is or is not complete'),
      finalResult: z.string().optional().describe('The final result text to return to the user'),
    });

    const schema = zodToJsonSchema(defaultCompletionSchema);
    const fixed = ensureAllPropertiesRequired(schema);

    expect(fixed.type).toBe('object');
    expect(fixed.required).toEqual(expect.arrayContaining(['isComplete', 'completionReason', 'finalResult']));
    expect(fixed.required).toHaveLength(3);
  });

  it('should recursively fix nested object schemas', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        outer: {
          type: 'object' as const,
          properties: {
            required: { type: 'string' as const },
            optional: { type: ['string', 'null'] as const },
          },
          required: ['required'],
        },
      },
      required: [] as string[],
    };

    const fixed = ensureAllPropertiesRequired(schema);

    expect(fixed.required).toContain('outer');

    const outerProp = fixed.properties!.outer as any;
    expect(outerProp.required).toContain('required');
    expect(outerProp.required).toContain('optional');
  });

  it('should handle schemas without properties (no-op)', () => {
    const schema = { type: 'string' as const };
    const fixed = ensureAllPropertiesRequired(schema);
    expect(fixed).toEqual({ type: 'string' });
  });

  it('should handle null/non-object schemas', () => {
    expect(ensureAllPropertiesRequired(null as any)).toBeNull();
    expect(ensureAllPropertiesRequired(true as any)).toBe(true);
  });

  it('should handle schemas with items (arrays)', () => {
    const schema = {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          age: { type: ['number', 'null'] as const },
        },
        required: ['name'],
      },
    };

    const fixed = ensureAllPropertiesRequired(schema);
    const items = fixed.items as any;
    expect(items.required).toContain('name');
    expect(items.required).toContain('age');
  });

  it('should handle anyOf/oneOf/allOf schemas', () => {
    const schema = {
      anyOf: [
        {
          type: 'object' as const,
          properties: {
            a: { type: 'string' as const },
            b: { type: ['string', 'null'] as const },
          },
          required: ['a'],
        },
      ],
    };

    const fixed = ensureAllPropertiesRequired(schema);
    const branch = (fixed.anyOf as any)[0];
    expect(branch.required).toContain('a');
    expect(branch.required).toContain('b');
  });

  it('should not modify zodToJsonSchema default behavior', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result = zodToJsonSchema(schema);
    expect(result.required).toContain('required');
    expect(result.required).not.toContain('optional');
  });
});

describe('stripJsonSchemaFields', () => {
  it('removes $schema from the root', () => {
    const schema = zodToJsonSchema(z.object({ name: z.string() }));
    expect(schema).toHaveProperty('$schema');
    const stripped = stripJsonSchemaFields(schema, ['$schema']);
    expect(stripped).not.toHaveProperty('$schema');
    expect(stripped.type).toBe('object');
  });

  it('removes additionalProperties from root and nested objects', () => {
    const schema = zodToJsonSchema(
      z.object({
        user: z.object({ name: z.string() }),
      }),
    );
    const stripped = stripJsonSchemaFields(schema, ['additionalProperties']);
    expect(stripped).not.toHaveProperty('additionalProperties');
    const userProp = (stripped.properties as any)?.user;
    expect(userProp).not.toHaveProperty('additionalProperties');
  });

  it('removes multiple keys at once', () => {
    const schema = zodToJsonSchema(z.object({ city: z.string().describe('city name') }));
    const stripped = stripJsonSchemaFields(schema, ['$schema', 'additionalProperties']);
    expect(stripped).not.toHaveProperty('$schema');
    expect(stripped).not.toHaveProperty('additionalProperties');
    expect(stripped.type).toBe('object');
    expect((stripped.properties as any)?.city?.type).toBe('string');
  });

  it('preserves descriptions and required fields', () => {
    const schema = zodToJsonSchema(
      z.object({
        location: z.string().describe('The city'),
        count: z.number().optional(),
      }),
    );
    const stripped = stripJsonSchemaFields(schema, ['$schema', 'additionalProperties']);
    expect((stripped.properties as any)?.location?.description).toBe('The city');
    expect(stripped.required).toContain('location');
    expect(stripped.required).not.toContain('count');
  });

  it('recurses into anyOf / oneOf / allOf', () => {
    const schema: any = {
      anyOf: [{ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, { type: 'null' }],
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    };
    const stripped = stripJsonSchemaFields(schema, ['$schema', 'additionalProperties']);
    expect(stripped).not.toHaveProperty('$schema');
    expect((stripped.anyOf as any[])[0]).not.toHaveProperty('additionalProperties');
  });

  it('recurses into array items', () => {
    const schema: any = {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { x: { type: 'number' } } },
    };
    const stripped = stripJsonSchemaFields(schema, ['additionalProperties']);
    expect(stripped.items as any).not.toHaveProperty('additionalProperties');
  });

  it('preserves a property named "additionalProperties" inside properties', () => {
    // The JSON schema keyword `additionalProperties` should be stripped, but a user-defined
    // property that happens to be named "additionalProperties" must be kept intact.
    const schema: any = {
      type: 'object',
      properties: {
        additionalProperties: { type: 'string', description: 'a normal field' },
        name: { type: 'string' },
      },
      required: ['additionalProperties', 'name'],
      additionalProperties: false, // ← JSON schema keyword, should be stripped
    };
    const stripped = stripJsonSchemaFields(schema, ['$schema', 'additionalProperties']);

    // JSON schema keyword removed
    expect(stripped).not.toHaveProperty('additionalProperties');

    // User-defined property preserved
    expect(stripped.properties as any).toHaveProperty('additionalProperties');
    expect((stripped.properties as any).additionalProperties).toEqual({
      type: 'string',
      description: 'a normal field',
    });
    expect(stripped.required).toContain('additionalProperties');
    expect(stripped.required).toContain('name');
  });

  it('preserves a property named "additionalProperties" inside deeply nested properties', () => {
    const schema: any = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            additionalProperties: { type: 'boolean' }, // user-defined field
          },
          additionalProperties: false, // JSON schema keyword
        },
      },
      additionalProperties: false, // JSON schema keyword
    };
    const stripped = stripJsonSchemaFields(schema, ['additionalProperties']);

    // Top-level keyword removed
    expect(stripped).not.toHaveProperty('additionalProperties');

    const config = (stripped.properties as any)?.config;
    // Nested keyword removed
    expect(config).not.toHaveProperty('additionalProperties');
    // Nested user-defined property preserved
    expect(config?.properties).toHaveProperty('additionalProperties');
    expect(config?.properties?.additionalProperties).toEqual({ type: 'boolean' });
  });

  it('returns non-object values unchanged', () => {
    expect(stripJsonSchemaFields(null as any, ['$schema'])).toBeNull();
    expect(stripJsonSchemaFields('string' as any, ['$schema'])).toBe('string');
  });

  it('Gemini use-case: zodToJsonSchema + strip produces clean parameters', () => {
    const schema = zodToJsonSchema(
      z.object({
        location: z.string().describe('The city or location to get weather for'),
        unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit'),
      }),
    );
    const params = stripJsonSchemaFields(schema, ['$schema', 'additionalProperties']);
    expect(params).not.toHaveProperty('$schema');
    expect(params).not.toHaveProperty('additionalProperties');
    expect(params.type).toBe('object');
    expect((params.properties as any)?.location?.type).toBe('string');
    expect((params.properties as any)?.unit?.enum).toEqual(['celsius', 'fahrenheit']);
    expect(params.required).toContain('location');
    expect(params.required).not.toContain('unit');
  });
});
