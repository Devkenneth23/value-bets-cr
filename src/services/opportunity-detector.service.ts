import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { BettingMathService, type OutcomeOdds } from "./betting-math.service";
import type { OpportunityType, Prisma } from "@prisma/client";

const MIN_EV_THRESHOLD = 0.02; // solo guardar value bets con EV mayor a 2%
const ODDS_FRESHNESS_MINUTES = 30; // ignorar cuotas mas viejas que esto

export class OpportunityDetectorService {
  /**
   * Corre deteccion completa sobre todos los eventos con cuotas recientes.
   * Disenado para correr despues de cada ciclo de ingestion.
   */
  static async detectAll(): Promise<{ arbitrageFound: number; valueBetsFound: number }> {
    const cutoff = new Date(Date.now() - ODDS_FRESHNESS_MINUTES * 60 * 1000);

    const events = await prisma.event.findMany({
      where: {
        commenceTime: { gt: new Date() },
        odds: { some: { fetchedAt: { gt: cutoff } } },
      },
      include: {
        odds: {
          where: { fetchedAt: { gt: cutoff } },
          include: { bookmaker: true, market: true },
          orderBy: { fetchedAt: "desc" },
        },
      },
    });

    let arbitrageFound = 0;
    let valueBetsFound = 0;

    for (const event of events) {
      const latestOddsByBookmakerOutcome = this.dedupeToLatestPerBookmaker(event.odds);

      const marketKeys = [...new Set(latestOddsByBookmakerOutcome.map((o) => o.market.key))];

      for (const marketKey of marketKeys) {
        const marketOdds = latestOddsByBookmakerOutcome.filter((o) => o.market.key === marketKey);

        const arbitrageDetected = await this.checkArbitrage(event.id, marketKey, marketOdds);
        if (arbitrageDetected) arbitrageFound++;

        const valueBetsDetected = await this.checkValueBets(event.id, marketKey, marketOdds);
        valueBetsFound += valueBetsDetected;
      }
    }

    return { arbitrageFound, valueBetsFound };
  }

  /**
   * Dado que guardamos cada fetch como fila nueva (historial), nos quedamos solo
   * con la cuota mas reciente por combinacion bookmaker + outcome.
   */
  private static dedupeToLatestPerBookmaker<
    T extends { bookmakerId: string; outcomeName: string; fetchedAt: Date; market: { key: string } }
  >(odds: T[]): T[] {
    const seen = new Map<string, T>();
    for (const odd of odds) {
      const key = `${odd.bookmakerId}-${odd.outcomeName}-${odd.market.key}`;
      const existing = seen.get(key);
      if (!existing || odd.fetchedAt > existing.fetchedAt) {
        seen.set(key, odd);
      }
    }
    return Array.from(seen.values());
  }

  private static async checkArbitrage(
    eventId: string,
    marketKey: string,
    marketOdds: Array<{
      outcomeName: string;
      price: Prisma.Decimal;
      bookmaker: { key: string };
    }>
  ): Promise<boolean> {
    const outcomeNames = [...new Set(marketOdds.map((o) => o.outcomeName))];

    // Arbitraje solo tiene sentido si hay mas de un resultado posible (h2h con 2-3 outcomes)
    if (outcomeNames.length < 2) return false;

    const bestOddsPerOutcome: OutcomeOdds[] = outcomeNames.map((outcomeName) => {
      const oddsForOutcome = marketOdds.filter((o) => o.outcomeName === outcomeName);
      const best = oddsForOutcome.reduce((max, curr) =>
        Number(curr.price) > Number(max.price) ? curr : max
      );
      return {
        outcomeName,
        bookmakerKey: best.bookmaker.key,
        price: Number(best.price),
      };
    });

    const result = BettingMathService.detectArbitrage(bestOddsPerOutcome);

    if (!result.isArbitrage) return false;

    await prisma.opportunity.create({
      data: {
        eventId,
        type: "ARBITRAGE" as OpportunityType,
        marketKey,
        guaranteedProfit: result.guaranteedProfitPercentage,
        details: result as unknown as Prisma.InputJsonValue,
      },
    });

    return true;
  }

  private static async checkValueBets(
    eventId: string,
    marketKey: string,
    marketOdds: Array<{
      outcomeName: string;
      price: Prisma.Decimal;
      bookmaker: { key: string };
    }>
  ): Promise<number> {
    const outcomeNames = [...new Set(marketOdds.map((o) => o.outcomeName))];
    let found = 0;

    for (const outcomeName of outcomeNames) {
      const oddsForOutcome = marketOdds.filter((o) => o.outcomeName === outcomeName);
      const allPrices = oddsForOutcome.map((o) => Number(o.price));

      // Evaluar TODAS las casas disponibles contra el consenso del mercado.
      // Antes estaba hardcodeado a bet365, pero esa casa no siempre aparece
      // en la respuesta de The Odds API segun la region/deporte. Generalizar
      // permite detectar value bets sin importar que casa ofrezca la cuota.
      for (const candidateOdd of oddsForOutcome) {
        const evaluation = BettingMathService.evaluateValueBet(
          outcomeName,
          candidateOdd.bookmaker.key,
          Number(candidateOdd.price),
          allPrices,
          env.KELLY_FRACTION_MULTIPLIER
        );

        if (evaluation.expectedValue < MIN_EV_THRESHOLD) continue;

        await prisma.opportunity.create({
          data: {
            eventId,
            type: "VALUE_BET" as OpportunityType,
            marketKey,
            expectedValue: evaluation.expectedValue,
            kellyFraction: evaluation.kellyFractionRecommended,
            details: evaluation as unknown as Prisma.InputJsonValue,
          },
        });

        found++;
      }
    }

    return found;
  }
}
