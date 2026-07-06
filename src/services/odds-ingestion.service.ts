import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  oddsApiEventListSchema,
  oddsApiSportListSchema,
  type OddsApiEvent,
} from "@/types/odds-api";

// Deportes activos que se ingieren en cada ciclo.
// The Odds API requiere pedir por sport_key, no hay endpoint "todos" que devuelva cuotas.
// Esta lista se sincroniza dinamicamente contra /v4/sports en syncActiveSports().
const DEFAULT_SPORT_KEYS = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_uefa_champs_league",
  "basketball_nba",
  "americanfootball_nfl",
  "tennis_atp_wimbledon",
  "mma_mixed_martial_arts",
];

const REGIONS = "eu,uk,us"; // bet365 aparece bajo "uk" y "eu" segun el mercado
const MARKETS = "h2h"; // moneyline / 1x2. Se puede extender a "h2h,spreads,totals"

// Timeout para llamadas a The Odds API. Evita que un cuelgue de red deje
// el proceso bloqueado indefinidamente dentro del limite de Vercel Functions.
const FETCH_TIMEOUT_MS = 30_000;

export class OddsIngestionService {
  // Caches en memoria para evitar upserts repetidos durante una corrida.
  // Bookmaker y Market se repiten en decenas de eventos (ej. bet365 aparece en todos).
  // Sin cache, cada evento generaba un upsert redundante por cada bookmaker/market ya conocido.
  private static bookmakerCache = new Map<string, string>(); // key -> id
  private static marketCache = new Map<string, string>(); // key -> id
  private static sportCache = new Map<string, string>(); // key -> id

  private static buildUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${env.ODDS_API_BASE_URL}${path}`);
    url.searchParams.set("apiKey", env.ODDS_API_KEY);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /**
   * Fetch con AbortController timeout. Si la red no responde en FETCH_TIMEOUT_MS,
   * aborta la request en vez de colgar el proceso hasta que Vercel lo mate.
   */
  private static async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Resuelve el ID de un bookmaker, usando cache en memoria para evitar
   * roundtrips repetidos a la DB dentro de la misma corrida.
   */
  private static async resolveBookmakerId(key: string, title: string): Promise<string> {
    const cached = this.bookmakerCache.get(key);
    if (cached) return cached;

    const dbBookmaker = await prisma.bookmaker.upsert({
      where: { key },
      update: { title },
      create: { key, title },
    });

    this.bookmakerCache.set(key, dbBookmaker.id);
    return dbBookmaker.id;
  }

  /**
   * Resuelve el ID de un market, usando cache en memoria.
   */
  private static async resolveMarketId(key: string): Promise<string> {
    const cached = this.marketCache.get(key);
    if (cached) return cached;

    const dbMarket = await prisma.market.upsert({
      where: { key },
      update: {},
      create: { key },
    });

    this.marketCache.set(key, dbMarket.id);
    return dbMarket.id;
  }

  /**
   * Resuelve el ID de un sport, usando cache en memoria.
   */
  private static async resolveSportId(key: string): Promise<string> {
    const cached = this.sportCache.get(key);
    if (cached) return cached;

    const dbSport = await prisma.sport.upsert({
      where: { key },
      update: {},
      create: { key, title: key, group: "unknown", isActive: true },
    });

    this.sportCache.set(key, dbSport.id);
    return dbSport.id;
  }

  /**
   * Sincroniza la lista de deportes activos disponibles en The Odds API.
   * Util para descubrir nuevas ligas/torneos sin hardcodear todo.
   */
  static async syncActiveSports(): Promise<number> {
    const url = this.buildUrl("/sports", {});
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(
        `Error consultando /sports: ${response.status} ${response.statusText}`
      );
    }

    const rawData = await response.json();
    const sports = oddsApiSportListSchema.parse(rawData);

    let syncedCount = 0;

    for (const sport of sports) {
      if (!sport.active || sport.has_outrights) continue;

      await prisma.sport.upsert({
        where: { key: sport.key },
        update: { title: sport.title, group: sport.group, isActive: true },
        create: {
          key: sport.key,
          title: sport.title,
          group: sport.group,
          isActive: true,
        },
      });

      // Poblar el cache de sports con los datos frescos
      this.sportCache.set(sport.key, (await prisma.sport.findUnique({ where: { key: sport.key } }))!.id);
      syncedCount++;
    }

    return syncedCount;
  }

  /**
   * Trae cuotas para un deporte especifico y las persiste.
   * Retorna cuantos eventos se procesaron.
   */
  static async ingestSport(sportKey: string): Promise<number> {
    const url = this.buildUrl(`/sports/${sportKey}/odds`, {
      regions: REGIONS,
      markets: MARKETS,
      oddsFormat: "decimal",
    });

    const response = await this.fetchWithTimeout(url);

    if (response.status === 404) {
      console.warn(`Sport key no encontrado o sin eventos activos: ${sportKey}`);
      return 0;
    }

    if (!response.ok) {
      throw new Error(
        `Error consultando odds de ${sportKey}: ${response.status} ${response.statusText}`
      );
    }

    const rawData = await response.json();
    const events = oddsApiEventListSchema.parse(rawData);

    for (const event of events) {
      await this.persistEvent(sportKey, event);
    }

    return events.length;
  }

  /**
   * Ejecuta ingestion completa para todos los deportes configurados.
   * Disenado para correr via cron (Vercel Cron cada 10-15 min).
   * Limpia caches al inicio para asegurar consistencia entre corridas.
   */
  static async ingestAllConfiguredSports(): Promise<{
    sportKey: string;
    eventsProcessed: number;
    error?: string;
  }[]> {
    // Limpiar caches al inicio de cada corrida completa.
    // En Vercel Functions el modulo se puede reutilizar entre invocaciones (Fluid Compute),
    // asi que los Maps estaticos podrian tener datos stale de una corrida anterior.
    this.bookmakerCache.clear();
    this.marketCache.clear();
    this.sportCache.clear();

    const results: { sportKey: string; eventsProcessed: number; error?: string }[] = [];

    for (const sportKey of DEFAULT_SPORT_KEYS) {
      try {
        const count = await this.ingestSport(sportKey);
        results.push({ sportKey, eventsProcessed: count });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        console.error(`Fallo ingestion de ${sportKey}:`, message);
        results.push({ sportKey, eventsProcessed: 0, error: message });
      }
    }

    return results;
  }

  private static async persistEvent(sportKey: string, event: OddsApiEvent): Promise<void> {
    const sportId = await this.resolveSportId(sportKey);

    const dbEvent = await prisma.event.upsert({
      where: { externalId: event.id },
      update: {
        commenceTime: new Date(event.commence_time),
        homeTeam: event.home_team,
        awayTeam: event.away_team,
      },
      create: {
        externalId: event.id,
        sportId,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        commenceTime: new Date(event.commence_time),
      },
    });

    // Acumular todas las filas de Odds del evento para insertarlas en un solo
    // createMany() al final, en vez de un create() individual por cada outcome.
    // Con ~30 bookmakers x 1 market x 3 outcomes = ~90 creates individuales por evento,
    // esto reduce ~90 roundtrips a la DB a 1 solo batch insert.
    const oddsRows: {
      eventId: string;
      bookmakerId: string;
      marketId: string;
      outcomeName: string;
      price: number;
      point: number | null;
    }[] = [];

    for (const bookmaker of event.bookmakers) {
      const bookmakerId = await this.resolveBookmakerId(bookmaker.key, bookmaker.title);

      for (const market of bookmaker.markets) {
        // Descartar mercados "_lay" (e.g. h2h_lay, outrights_lay) provenientes de exchanges
        // como Betfair/Matchbook. Son cuotas de apostar EN CONTRA de un resultado y su
        // probabilidad implicita no es comparable con cuotas normales (back odds).
        // Incluirlos genera falsos positivos de arbitraje con profit irreal.
        if (market.key.endsWith("_lay")) continue;

        const marketId = await this.resolveMarketId(market.key);

        for (const outcome of market.outcomes) {
          oddsRows.push({
            eventId: dbEvent.id,
            bookmakerId,
            marketId,
            outcomeName: outcome.name,
            price: outcome.price,
            point: outcome.point ?? null,
          });
        }
      }
    }

    // Batch insert: un solo roundtrip a la DB por evento en vez de N creates individuales.
    if (oddsRows.length > 0) {
      await prisma.odds.createMany({ data: oddsRows });
    }
  }
}
