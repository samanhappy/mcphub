import { InMemoryServerEventBus } from '@modelcontextprotocol/server';
import { logger } from '../utils/logger.js';

export const mcpEventBus = new InMemoryServerEventBus((error) => {
  logger.warn('Failed to deliver modern MCP change event:', error.message);
});
