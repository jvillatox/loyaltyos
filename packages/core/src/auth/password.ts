import { hash, verify } from "argon2";

const OWASP_2024 = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2, // 2 iterations
  parallelism: 1, // 1 thread
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    type: 2, // argon2id
    memoryCost: OWASP_2024.memoryCost,
    timeCost: OWASP_2024.timeCost,
    parallelism: OWASP_2024.parallelism,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await verify(hash, password);
  } catch {
    return false;
  }
}
