import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ODDS_API_KEY: z.string().min(1, "ODDS_API_KEY es obligatoria"),
  ODDS_API_BASE_URL: z.string().url().default("https://api.the-odds-api.com/v4"),
  BANKROLL_TOTAL: z.coerce.number().positive().default(100),
  KELLY_FRACTION_MULTIPLIER: z.coerce.number().min(0).max(1).default(0.25),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Variables de entorno invalidas:", parsed.error.flatten().fieldErrors);
    throw new Error("Configuracion de entorno invalida. Revisa el archivo .env");
  }

  return parsed.data;
}

export const env = loadEnv();
