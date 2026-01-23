import { app } from './api';
import { closeDatabase } from './db';
import { closeQueues } from './queue';
import { logger } from './observability';

const PORT = parseInt(process.env.PORT || '3000', 10);

// Start server
logger.info(`Starting Pluribus server on port ${PORT}`, {
  nodeEnv: process.env.NODE_ENV,
  port: PORT,
});

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

logger.info(`Pluribus server running at http://localhost:${server.port}`);

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    // Close database connections
    await closeDatabase();
    logger.info('Database connections closed');

    // Close queue connections
    await closeQueues();
    logger.info('Queue connections closed');

    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: String(error) });
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
