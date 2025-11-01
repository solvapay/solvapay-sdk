import { z } from "zod";

export const Env = z.object({
  SOLVAPAY_SECRET_KEY: z.string().min(1),
  SOLVAPAY_API_BASE_URL: z.string().url().optional(),
});
export type Env = z.infer<typeof Env>;

export class SolvaPayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolvaPayError";
  }
}

export const version = "0.1.0";
