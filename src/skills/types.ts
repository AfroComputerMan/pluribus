import type { z } from 'zod';
import type { skillSchema } from './schemas';

export type Skill = z.infer<typeof skillSchema>;
export type CreateSkillInput = Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateSkillInput = Partial<CreateSkillInput>;

// Skill types
export type SkillType = 'prompt' | 'behavior' | 'workflow-template';
export type SkillSource = 'user' | 'imported' | 'builtin';

// Skill parameter definition
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  required: boolean;
  default?: unknown | undefined;
  options?: string[] | undefined; // For select type
}

// Skill with rendered content
export interface RenderedSkill {
  id: string;
  name: string;
  content: string;
  originalContent: string;
  parameters: Record<string, unknown>;
}

// Filter options
export interface SkillFilter {
  tags?: string[];
  type?: SkillType;
  source?: SkillSource;
  search?: string;
  limit?: number;
  offset?: number;
}

// Import/export format
export interface SkillExport {
  version: '1.0';
  skill: {
    name: string;
    description: string | null;
    type: SkillType;
    content: string;
    tags: string[];
    parameters?: SkillParameter[];
  };
}

// Bulk import result
export interface ImportResult {
  imported: Skill[];
  skipped: Array<{ name: string; reason: string }>;
  errors: Array<{ name: string; error: string }>;
}

// Import options
export interface ImportOptions {
  conflictResolution: 'skip' | 'overwrite' | 'rename';
}

// Template validation result
export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    message: string;
    line?: number;
    column?: number;
  }>;
  warnings: Array<{
    message: string;
    parameter?: string;
  }>;
  requiredParameters: string[];
}
