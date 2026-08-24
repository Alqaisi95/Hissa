import { createApp } from './app.ts';
import { config } from './config.ts';
import { startScheduler } from './workflow/scheduler.ts';

const app = createApp();
const scheduler = startScheduler(Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000));

const server = app.listen(config.port, () => {
  console.log(`حِصّة | Hissa Pools API → http://localhost:${config.port}  (${config.env})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
}
