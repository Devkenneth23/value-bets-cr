/**
 * Funciones matematicas puras para analisis de apuestas.
 * Sin dependencias de DB — testeable de forma aislada.
 */

export interface OutcomeOdds {
  outcomeName: string;
  bookmakerKey: string;
  price: number;
}

export interface ArbitrageResult {
  isArbitrage: boolean;
  totalImpliedProbability: number;
  guaranteedProfitPercentage: number;
  stakes: { outcomeName: string; bookmakerKey: string; price: number; stakePercentage: number }[];
}

export interface ValueBetResult {
  outcomeName: string;
  bookmakerKey: string;
  price: number;
  consensusProbability: number;
  impliedProbability: number;
  edgePercentage: number;
  expectedValue: number;
  kellyFractionFull: number;
  kellyFractionRecommended: number;
}

export class BettingMathService {
  private static readonly DEFAULT_KELLY_MULTIPLIER = 0.25;

  static impliedProbability(decimalOdds: number): number {
    if (decimalOdds <= 1) {
      throw new Error("La cuota decimal debe ser mayor a 1.0");
    }
    return 1 / decimalOdds;
  }

  /**
   * Remueve el vig (overround) de un bookmaker usando todos sus outcomes del mismo mercado.
   * Divide cada probabilidad implicita entre la suma total para que sumen exactamente 1.
   */
  static devigImpliedProbabilities(pricesForAllOutcomesOneBookmaker: number[]): number[] {
    if (pricesForAllOutcomesOneBookmaker.length === 0) {
      throw new Error("Se necesita al menos un outcome para de-viguear");
    }

    const rawProbs = pricesForAllOutcomesOneBookmaker.map((price) => this.impliedProbability(price));
    const totalRaw = rawProbs.reduce((sum, p) => sum + p, 0);

    return rawProbs.map((p) => p / totalRaw);
  }

  static median(values: number[]): number {
    if (values.length === 0) {
      throw new Error("Se necesita al menos un valor para calcular mediana");
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      const lower = sorted[mid - 1] as number;
      const upper = sorted[mid] as number;
      return (lower + upper) / 2;
    }
    return sorted[mid] as number;
  }

  /**
   * Probabilidad de consenso a partir de probabilidades YA de-vigueadas de casas peer
   * (excluyendo la casa que se esta evaluando). Usa mediana por robustez.
   */
  static consensusProbability(peerDevigProbabilities: number[]): number {
    if (peerDevigProbabilities.length === 0) {
      throw new Error("Se necesita al menos una probabilidad peer para calcular consenso");
    }
    return this.median(peerDevigProbabilities);
  }

  static detectArbitrage(bestOddsPerOutcome: OutcomeOdds[]): ArbitrageResult {
    const totalImpliedProbability = bestOddsPerOutcome.reduce(
      (sum, outcome) => sum + this.impliedProbability(outcome.price),
      0
    );

    const isArbitrage = totalImpliedProbability < 1;
    const guaranteedProfitPercentage = isArbitrage
      ? (1 / totalImpliedProbability - 1) * 100
      : 0;

    const stakes = bestOddsPerOutcome.map((outcome) => {
      const outcomeImpliedProb = this.impliedProbability(outcome.price);
      const stakePercentage = (outcomeImpliedProb / totalImpliedProbability) * 100;
      return {
        outcomeName: outcome.outcomeName,
        bookmakerKey: outcome.bookmakerKey,
        price: outcome.price,
        stakePercentage: Number(stakePercentage.toFixed(2)),
      };
    });

    return {
      isArbitrage,
      totalImpliedProbability: Number(totalImpliedProbability.toFixed(4)),
      guaranteedProfitPercentage: Number(guaranteedProfitPercentage.toFixed(2)),
      stakes,
    };
  }

  static expectedValue(consensusProb: number, offeredPrice: number): number {
    return consensusProb * offeredPrice - 1;
  }

  static kellyFraction(winProbability: number, decimalOdds: number): number {
    const b = decimalOdds - 1;
    const p = winProbability;
    const q = 1 - p;
    const fraction = (b * p - q) / b;
    return Math.max(0, fraction);
  }

  /**
   * Evalua una cuota contra la mediana de probabilidades de-vigueadas de casas peer.
   */
  static evaluateValueBet(
    outcomeName: string,
    bookmakerKey: string,
    offeredPrice: number,
    peerDevigProbabilitiesForOutcome: number[],
    kellyMultiplier: number = this.DEFAULT_KELLY_MULTIPLIER
  ): ValueBetResult {
    const consensusProb = this.consensusProbability(peerDevigProbabilitiesForOutcome);
    const impliedProb = this.impliedProbability(offeredPrice);
    const edgePercentage = (consensusProb - impliedProb) * 100;
    const ev = this.expectedValue(consensusProb, offeredPrice);
    const kellyFull = this.kellyFraction(consensusProb, offeredPrice);
    const kellyRecommended = kellyFull * kellyMultiplier;

    return {
      outcomeName,
      bookmakerKey,
      price: offeredPrice,
      consensusProbability: Number(consensusProb.toFixed(4)),
      impliedProbability: Number(impliedProb.toFixed(4)),
      edgePercentage: Number(edgePercentage.toFixed(2)),
      expectedValue: Number(ev.toFixed(4)),
      kellyFractionFull: Number(kellyFull.toFixed(4)),
      kellyFractionRecommended: Number(kellyRecommended.toFixed(4)),
    };
  }

  static stakeAmount(bankrollTotal: number, kellyFractionRecommended: number): number {
    return Number((bankrollTotal * kellyFractionRecommended).toFixed(2));
  }
}
