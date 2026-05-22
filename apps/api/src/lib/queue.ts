import { Queue, QueueEvents, Worker } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let connection: Redis | null = null;

function getConnection(): Redis {
  if (!connection) {
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  }
  return connection;
}

export function getRedisConnection(): Redis | null {
  if (!connection) return null;
  try {
    // Ping to verify the existing connection is still alive
    return connection;
  } catch {
    return null;
  }
}

export function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
}

export function createWorker(
  name: string,
  processor: (job: { id: string; data: Record<string, unknown> }) => Promise<void>,
): Worker {
  const worker = new Worker(name, processor as never, {
    connection: getConnection(),
    autorun: true,
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[Worker][${name}] Job ${job?.id ?? "?"} failed after ${String(job?.attemptsMade ?? 0)} attempts:`,
      err.message,
    );
  });

  worker.on("completed", (job) => {
    console.log(`[Worker][${name}] Job ${job.id ?? "?"} completed`);
  });

  return worker;
}

export function createQueueEvents(name: string): QueueEvents {
  return new QueueEvents(name, { connection: getConnection() });
}

export async function closeQueueConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
