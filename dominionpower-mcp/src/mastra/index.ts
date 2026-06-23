import { Mastra } from '@mastra/core/mastra';
import { MCPServer } from '@mastra/mcp';
import { PinoLogger } from '@mastra/loggers';
import { DominionService } from './lib/dominion-service.js';

const service = new DominionService();
await service.initialize();

const mcpServer = new MCPServer({
  id: 'dominion-energy',
  name: 'Dominion Energy',
  version: '1.0.0',
  description: 'Live Dominion Energy usage, billing, solar, and weather data',
  instructions:
    'Use these tools to get live Dominion Energy data including energy consumption, ' +
    'solar generation, billing information, weather data, and meter information. ' +
    "Data is refreshed every 12 hours from Dominion Energy's API.",
  tools: service.getTools(),
});

export const mastra = new Mastra({
  mcpServers: { dominionEnergy: mcpServer },
  server: {
    port: parseInt(process.env.PORT || '3456', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: (process.env.LOG_LEVEL ?? 'info') as any,
  }),
});

process.on('SIGINT', async () => {
  await service.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await service.shutdown();
  process.exit(0);
});
