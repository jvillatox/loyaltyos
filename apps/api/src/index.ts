import { buildApp, prisma } from "./app.js";

const app = await buildApp();

// Start
const port = Number(process.env.PORT_API) || 3000;
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`Server running on http://${host}:${String(port)}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app, prisma };
