import Handlebars from 'handlebars';
import { createLogger } from '@/observability/logger';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { skillRepository } from './repository';
import type {
  CreateSkillInput,
  ImportOptions,
  ImportResult,
  Skill,
  SkillExport,
  SkillFilter,
  SkillParameter,
  UpdateSkillInput,
  ValidationResult,
} from './types';

const logger = createLogger('skills:service');

export class SkillService {
  constructor(private repository = skillRepository) {
    this.registerHelpers();
  }

  private registerHelpers(): void {
    Handlebars.registerHelper('default', (value: unknown, defaultValue: unknown) => value ?? defaultValue);
    Handlebars.registerHelper('escape', (value: string) => Handlebars.escapeExpression(value));
    Handlebars.registerHelper('upper', (value: string) => typeof value === 'string' ? value.toUpperCase() : value);
    Handlebars.registerHelper('lower', (value: string) => typeof value === 'string' ? value.toLowerCase() : value);
  }

  async createSkill(data: CreateSkillInput): Promise<Skill> {
    logger.info('Creating skill', { name: data.name, type: data.type });
    if (data.parameters?.length) {
      const validation = await this.validateTemplate(data.content, data.parameters);
      if (!validation.valid) {
        throw new ValidationError('Template validation failed: ' + validation.errors.map(e => e.message).join(', '));
      }
    }
    const skill = await this.repository.create(data);
    logger.info('Skill created', { skillId: skill.id, name: skill.name });
    return skill;
  }

  async getSkill(id: string): Promise<Skill> {
    const skill = await this.repository.findById(id);
    if (!skill) throw new NotFoundError('Skill', id);
    return skill;
  }

  async listSkills(filter?: SkillFilter): Promise<Skill[]> {
    return this.repository.findAll(filter);
  }

  async updateSkill(id: string, data: UpdateSkillInput): Promise<Skill> {
    logger.info('Updating skill', { skillId: id });
    if (data.content || data.parameters) {
      const existing = await this.repository.findById(id);
      if (!existing) throw new NotFoundError('Skill', id);
      const content = data.content ?? existing.content;
      const parameters = data.parameters ?? existing.parameters;
      if (parameters?.length) {
        const validation = await this.validateTemplate(content, parameters);
        if (!validation.valid) {
          throw new ValidationError('Template validation failed: ' + validation.errors.map(e => e.message).join(', '));
        }
      }
    }
    return this.repository.update(id, data);
  }

  async deleteSkill(id: string): Promise<void> {
    logger.info('Deleting skill', { skillId: id });
    await this.repository.delete(id);
  }

  async renderSkill(id: string, params: Record<string, unknown>): Promise<string> {
    const skill = await this.repository.findById(id);
    if (!skill) throw new NotFoundError('Skill', id);
    logger.debug('Rendering skill', { skillId: id, params });
    if (skill.parameters?.length) {
      const required = skill.parameters.filter(p => p.required);
      const missing = required.filter(p => !(p.name in params) && p.default === undefined);
      if (missing.length > 0) {
        throw new ValidationError('Missing required parameters: ' + missing.map(p => p.name).join(', '));
      }
      const filledParams = { ...params };
      for (const param of skill.parameters) {
        if (!(param.name in filledParams) && param.default !== undefined) {
          filledParams[param.name] = param.default;
        }
      }
      const typedParams: Record<string, unknown> = {};
      for (const param of skill.parameters) {
        const value = filledParams[param.name];
        if (value !== undefined) typedParams[param.name] = this.coerceParameterValue(value, param);
      }
      const template = Handlebars.compile(skill.content, { noEscape: false, strict: true });
      return template(typedParams);
    }
    return skill.content;
  }

  private coerceParameterValue(value: unknown, param: SkillParameter): unknown {
    switch (param.type) {
      case 'number': return typeof value === 'number' ? value : Number(value);
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.toLowerCase() === 'true';
        return Boolean(value);
      case 'select':
        if (param.options && !param.options.includes(String(value))) {
          throw new ValidationError('Invalid value for parameter ' + param.name + '. Expected one of: ' + param.options.join(', '));
        }
        return String(value);
      default: return String(value);
    }
  }

  async validateTemplate(template: string, parameters?: SkillParameter[]): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];
    const requiredParameters: string[] = [];
    try {
      const compiled = Handlebars.compile(template, { strict: false });
      const usedParams = this.extractTemplateVariables(template);
      if (parameters) {
        const paramNames = new Set(parameters.map(p => p.name));
        const usedParamNames = new Set(usedParams);
        for (const param of parameters) {
          if (!usedParamNames.has(param.name)) {
            warnings.push({ message: 'Parameter \'' + param.name + '\' is declared but not used in template', parameter: param.name });
          }
          if (param.required) requiredParameters.push(param.name);
        }
        for (const used of usedParams) {
          if (!paramNames.has(used)) {
            warnings.push({ message: 'Template uses parameter \'' + used + '\' which is not declared', parameter: used });
          }
        }
      }
      const testData: Record<string, unknown> = {};
      for (const param of usedParams) testData[param] = 'test';
      compiled(testData);
    } catch (error) {
      errors.push({ message: error instanceof Error ? error.message : 'Template compilation failed' });
    }
    return { valid: errors.length === 0, errors, warnings, requiredParameters };
  }

  private extractTemplateVariables(template: string): string[] {
    const variables: string[] = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = regex.exec(template)) !== null) {
      if (!match[1]) continue;
      const expr = match[1].trim();
      const parts = expr.split(/\s+/);
      const varName = parts[0];
      if (varName && !['if', 'unless', 'each', 'with', 'lookup', 'default', 'escape', 'upper', 'lower'].includes(varName) &&
          !varName.startsWith('#') && !varName.startsWith('/')) {
        if (!variables.includes(varName)) variables.push(varName);
      }
    }
    return variables;
  }

  async importSkills(data: SkillExport[], options: ImportOptions = { conflictResolution: 'skip' }): Promise<ImportResult> {
    logger.info('Importing skills', { count: data.length, options });
    const result: ImportResult = { imported: [], skipped: [], errors: [] };
    for (const exportData of data) {
      try {
        const { skill } = exportData;
        const skillData = {
          ...skill,
          source: 'imported' as const,
          description: skill.description ?? null,
          parameters: skill.parameters ?? null
        } as CreateSkillInput;
        const existing = await this.repository.findByName(skill.name);
        if (existing) {
          if (options.conflictResolution === 'skip') {
            result.skipped.push({ name: skill.name, reason: 'Skill with this name already exists' });
            continue;
          } else if (options.conflictResolution === 'overwrite') {
            const updated = await this.repository.update(existing.id, skillData);
            result.imported.push(updated);
            logger.info('Skill overwritten', { skillId: existing.id, name: skill.name });
          } else if (options.conflictResolution === 'rename') {
            let newName = skill.name + ' (imported)';
            let counter = 1;
            while (await this.repository.findByName(newName)) {
              newName = skill.name + ' (imported ' + counter + ')';
              counter++;
            }
            const created = await this.repository.create({ ...skillData, name: newName });
            result.imported.push(created);
            logger.info('Skill imported with new name', { skillId: created.id, name: newName });
          }
        } else {
          const created = await this.repository.create(skillData);
          result.imported.push(created);
          logger.info('Skill imported', { skillId: created.id, name: skill.name });
        }
      } catch (error) {
        result.errors.push({ name: exportData.skill.name, error: error instanceof Error ? error.message : 'Unknown error' });
        logger.error('Failed to import skill', { name: exportData.skill.name, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
    logger.info('Import completed', { imported: result.imported.length, skipped: result.skipped.length, errors: result.errors.length });
    return result;
  }

  async exportSkills(ids: string[]): Promise<SkillExport[]> {
    logger.info('Exporting skills', { count: ids.length });
    const exports: SkillExport[] = [];
    for (const id of ids) {
      const skill = await this.repository.findById(id);
      if (!skill) {
        logger.warn('Skill not found for export', { skillId: id });
        continue;
      }
      exports.push({ version: '1.0', skill: { name: skill.name, description: skill.description, type: skill.type, content: skill.content, tags: skill.tags, parameters: skill.parameters ?? undefined } });
    }
    logger.info('Export completed', { count: exports.length });
    return exports;
  }

  async getTagStats(): Promise<Record<string, number>> {
    return this.repository.countByTags();
  }

  async getAllTags(): Promise<string[]> {
    return this.repository.getAllTags();
  }
}

export const skillService = new SkillService();
