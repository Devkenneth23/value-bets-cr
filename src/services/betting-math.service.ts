/**
 * Funciones matematicas puras para analisis de apuestas.
 * Sin dependencias de DB — testeable de forma aislada.
 */

export interface OutcomeOdds {
  outcomeName: string;
  bookmakerKey: string;
  price: number; // cuota decimal, ej: 2.15
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
  private static readonly DEFAULT_KELLY_MULTIPLIER = 0.25; // Kelly 1/4, conservador

  /**
   * Probabilidad implicita de una cuota decimal.
   * Cuota 2.00 implica 50% de probabilidad segun el mercado.
   */
  static impliedProbability(decimalOdds: number): number {
    if (decimalOdds <= 1) {
      throw new Error("La cuota decimal debe ser mayor a 1.0");
    }
    return 1 / decimalOdds;
  }

  /**
   * Detecta arbitraje entre las mejores cuotas de cada resultado posible de un evento.
   * Requiere una cuota por cada resultado mutuamente excluyente (ej: Home/Draw/Away).
   */
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

  /**
   * Calcula el consenso de probabilidad "real" a partir del promedio de todas las
   * casas disponibles para un resultado, normalizado para remover el overround (vig).
   */
  static consensusProbability(allOddsForOutcome: number[]): number {
    if (allOddsForOutcome.length === 0) {
      throw new Error("Se necesita al menos una cuota para calcular consenso");
    }
    const impliedProbs = allOddsForOutcome.map((price) => this.impliedProbability(price));
    const average = impliedProbs.reduce((sum, p) => sum + p, 0) / impliedProbs.length;
    return average;
  }

  /**
   * Expected value de una apuesta de $1: (probabilidad_real * cuota) - 1.
   * EV positivo significa que la cuota ofrecida es mayor a lo que el consenso del
   * mercado sugiere que deberia ser — no es garantia de ganar esa apuesta puntual.
   */
  static expectedValue(consensusProbability: number, offeredPrice: number): number {
    return consensusProbability * offeredPrice - 1;
  }

  /**
   * Kelly Criterion completo: fraccion optima de banca a apostar.
   * f* = (bp - q) / b
   * donde b = cuota_decimal - 1, p = probabilidad de ganar, q = 1 - p
   */
  static kellyFraction(winProbability: number, decimalOdds: number): number {
    const b = decimalOdds - 1;
    const p = winProbability;
    const q = 1 - p;
    const fraction = (b * p - q) / b;
    return Math.max(0, fraction); // nunca negativo, Kelly negativo = no apostar
  }

  /**
   * Evalua una cuota especifica contra el consenso del mercado y retorna
   * el analisis completo: EV, Kelly completo y Kelly fraccionado recomendado.
   */
  static evaluateValueBet(
    outcomeName: string,
    bookmakerKey: string,
    offeredPrice: number,
    allMarketOdds: number[],
    kellyMultiplier: number = this.DEFAULT_KELLY_MULTIPLIER
  ): ValueBetResult {
    const consensusProb = this.consensusProbability(allMarketOdds);
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

  /**
   * Calcula el monto en dinero a apostar dado el bankroll total y la fraccion de Kelly.
   */
  static stakeAmount(bankrollTotal: number, kellyFractionRecommended: number): number {
    return Number((bankrollTotal * kellyFractionRecommended).toFixed(2));
  }
}
