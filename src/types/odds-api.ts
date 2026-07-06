import { z } from "zod";

// Estructura real de respuesta de The Odds API v4
// https://the-odds-api.com/liveapi/guides/v4/

export const oddsApiOutcomeSchema = z.object({
  name: z.string(),
  price: z.number(),
  point: z.number().optional(),
});

export const oddsApiMarketSchema = z.object({
  key: z.string(),
  last_update: z.string(),
  outcomes: z.array(oddsApiOutcomeSchema),
});

export const oddsApiBookmakerSchema = z.object({
  key: z.string(),
  title: z.string(),
  last_update: z.string(),
  markets: z.array(oddsApiMarketSchema),
});

export const oddsApiEventSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  sport_title: z.string(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(oddsApiBookmakerSchema),
});

export const oddsApiEventListSchema = z.array(oddsApiEventSchema);

export const oddsApiSportSchema = z.object({
  key: z.string(),
  group: z.string(),
  title: z.string(),
  description: z.string(),
  active: z.boolean(),
  has_outrights: z.boolean(),
});

export const oddsApiSportListSchema = z.array(oddsApiSportSchema);

export type OddsApiEvent = z.infer<typeof oddsApiEventSchema>;
export type OddsApiBookmaker = z.infer<typeof oddsApiBookmakerSchema>;
export type OddsApiMarket = z.infer<typeof oddsApiMarketSchema>;
export type OddsApiOutcome = z.infer<typeof oddsApiOutcomeSchema>;
export type OddsApiSport = z.infer<typeof oddsApiSportSchema>;
