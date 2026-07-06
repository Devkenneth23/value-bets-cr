import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { BettingMathService, type OutcomeOdds } from "./betting-math.service";
import type { OpportunityType, Prisma } from "@prisma/client";

const MIN_EV_THRESHOLD = 0.02;
const ODDS_FRESHNESS_MINUTES = 30;
const MIN_PEER_BOOKMAKERS = 2;

export class OpportunityDetectorService {
  static async detectAll(): Promise<{ arbitrageFound: number; valueBetsFound: number }> {
    const cutoff = new Date(Date.now() - ODDS_FRESHNESS_MINUTES * 60 * 1000);

    await prisma.opportunity.updateMany({
      where: {
        event: { commenceTime: { gt: new Date() } },
      },
      data: { isActive: false },
    });

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

    await prisma.opportunity.upsert({
      where: {
        eventId_marketKey_outcomeName_bookmakerKey_type: {
          eventId,
          marketKey,
          outcomeName: "",
          bookmakerKey: "",
          type: "ARBITRAGE" as OpportunityType,
        },
      },
      update: {
        guaranteedProfit: result.guaranteedProfitPercentage,
        details: result as unknown as Prisma.InputJsonValue,
        isActive: true,
        detectedAt: new Date(),
      },
      create: {
        eventId,
        type: "ARBITRAGE" as OpportunityType,
        marketKey,
        outcomeName: "",
        bookmakerKey: "",
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
    const bookmakerKeys = [...new Set(marketOdds.map((o) => o.bookmaker.key))];

    const devigByBookmaker = new Map<string, Map<string, number>>();

    for (const bk of bookmakerKeys) {
      const allOutcomesForBookmaker = marketOdds.filter((o) => o.bookmaker.key === bk);
      const prices = allOutcomesForBookmaker.map((o) => Number(o.price));
      const devigProbs = BettingMathService.devigImpliedProbabilities(prices);

      const outcomeMap = new Map<string, number>();
      for (let i = 0; i < allOutcomesForBookmaker.length; i++) {
        const odd = allOutcomesForBookmaker[i];
        const prob = devigProbs[i];
        if (odd !== undefined && prob !== undefined) {
          outcomeMap.set(odd.outcomeName, prob);
        }
      }
      devigByBookmaker.set(bk, outcomeMap);
    }

    let found = 0;

    for (const outcomeName of outcomeNames) {
      const oddsForOutcome = marketOdds.filter((o) => o.outcomeName === outcomeName);

      for (const candidateOdd of oddsForOutcome) {
        const candidateBk = candidateOdd.bookmaker.key;

        const peerProbs: number[] = [];
        for (const [bk, outcomeMap] of devigByBookmaker) {
          if (bk === candidateBk) continue;
          const prob = outcomeMap.get(outcomeName);
          if (prob !== undefined) {
            peerProbs.push(prob);
          }
        }

        if (peerProbs.length < MIN_PEER_BOOKMAKERS) continue;

        const evaluation = BettingMathService.evaluateValueBet(
          outcomeName,
          candidateBk,
          Number(candidateOdd.price),
          peerProbs,
          env.KELLY_FRACTION_MULTIPLIER
        );

        if (evaluation.expectedValue < MIN_EV_THRESHOLD) continue;

        await prisma.opportunity.upsert({
          where: {
            eventId_marketKey_outcomeName_bookmakerKey_type: {
              eventId,
              marketKey,
              outcomeName,
              bookmakerKey: candidateBk,
              type: "VALUE_BET" as OpportunityType,
            },
          },
          update: {
            expectedValue: evaluation.expectedValue,
            kellyFraction: evaluation.kellyFractionRecommended,
            details: evaluation as unknown as Prisma.InputJsonValue,
            isActive: true,
            detectedAt: new Date(),
          },
          create: {
            eventId,
            type: "VALUE_BET" as OpportunityType,
            marketKey,
            outcomeName,
            bookmakerKey: candidateBk,
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
