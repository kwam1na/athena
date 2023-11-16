import { pino } from 'pino';
import pinoLoki from 'pino-loki';

const lokiTransport = pinoLoki({
   host: 'https://logs-prod-006.grafana.net',
   batching: false,
   labels: { application: 'athena' },
   basicAuth: {
      username: process.env.LOKI_USERNAME || '',
      password: process.env.LOKI_PASSWORD || '',
   },
});

const logger = pino(
   {
      level: 'info',
   },
   lokiTransport,
);

export default logger;
