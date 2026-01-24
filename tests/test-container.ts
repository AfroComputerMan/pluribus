import { PostgreSqlContainer } from '@testcontainers/postgresql';

async function main() {
  console.log('Starting PostgreSQL container...');
  const startTime = Date.now();

  try {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test')
      .withUsername('test')
      .withPassword('test')
      .withStartupTimeout(90000)
      .start();

    const elapsed = Date.now() - startTime;
    console.log(`Container started in ${elapsed}ms`);
    console.log(`Connection URI: ${container.getConnectionUri()}`);

    await container.stop();
    console.log('Container stopped');
  } catch (error) {
    console.error('Failed to start container:', error);
    process.exit(1);
  }
}

main();
