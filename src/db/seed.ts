import { closeDatabase, db } from './client';
import { agents, skills, workflows } from './schema';

async function seed(): Promise<void> {
  console.log('Seeding database...');

  try {
    // Create sample agents
    const [codeReviewer] = await db
      .insert(agents)
      .values({
        name: 'Code Reviewer',
        description: 'Reviews code for best practices, security issues, and style consistency',
        tags: ['code', 'review', 'quality'],
        modelConfig: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        },
        memoryMode: 'session',
        isolationLevel: 'shared',
        canSpawnSubAgents: false,
        skills: [],
        allowedMcpTools: ['*'],
      })
      .returning();

    const [docWriter] = await db
      .insert(agents)
      .values({
        name: 'Documentation Writer',
        description: 'Generates comprehensive documentation from code',
        tags: ['docs', 'documentation', 'writing'],
        modelConfig: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        },
        memoryMode: 'stateless',
        isolationLevel: 'shared',
        canSpawnSubAgents: false,
        skills: [],
        allowedMcpTools: ['*'],
      })
      .returning();

    console.log('Created agents:', codeReviewer?.name, docWriter?.name);

    // Create sample skills
    const [reviewSkill] = await db
      .insert(skills)
      .values({
        name: 'Security Review',
        description: 'Performs security-focused code review',
        type: 'prompt',
        content: `You are a security expert reviewing code for vulnerabilities.

Focus on:
- SQL injection
- XSS vulnerabilities
- Authentication/authorization issues
- Sensitive data exposure
- OWASP Top 10

Provide specific line references and remediation steps.`,
        tags: ['security', 'review'],
        source: 'builtin',
      })
      .returning();

    console.log('Created skill:', reviewSkill?.name);

    // Create sample workflow
    await db.insert(workflows).values({
      name: 'Code Review Pipeline',
      description: 'Automated code review with documentation generation',
      nodes: [
        {
          id: 'review',
          type: 'agent',
          agentId: codeReviewer?.id,
          input: { code: '{{input.code}}' },
        },
        {
          id: 'docs',
          type: 'agent',
          agentId: docWriter?.id,
          input: { code: '{{input.code}}', review: '{{review.output}}' },
        },
      ],
      edges: [{ id: 'e1', from: 'review', to: 'docs' }],
      triggers: [{ type: 'manual' }, { type: 'api' }],
      errorStrategy: {
        retries: 2,
        retryDelay: 5000,
        onFailure: 'stop',
      },
    });

    console.log('Created workflow: Code Review Pipeline');
    console.log('Seeding completed successfully');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

seed();
