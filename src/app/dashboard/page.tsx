import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const opportunities = await prisma.opportunity.findMany({
    where: {
      isActive: true,
      event: { commenceTime: { gt: new Date() } },
    },
    include: {
      event: { include: { sport: true } },
    },
    orderBy: [{ guaranteedProfit: "desc" }, { expectedValue: "desc" }],
    take: 50,
  });

  const arbitrage = opportunities.filter((o) => o.type === "ARBITRAGE");
  const valueBets = opportunities.filter((o) => o.type === "VALUE_BET");

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <h1 className="text-2xl font-semibold mb-6">Value Bets CR</h1>

      <section className="mb-10">
        <h2 className="text-lg font-medium mb-3 text-emerald-400">
          Arbitraje ({arbitrage.length})
        </h2>
        {arbitrage.length === 0 && (
          <p className="text-slate-400 text-sm">Sin oportunidades de arbitraje activas.</p>
        )}
        <div className="space-y-3">
          {arbitrage.map((opp) => (
            <div key={opp.id} className="border border-slate-800 rounded-lg p-4 bg-slate-900">
              <p className="font-medium">
                {opp.event.homeTeam} vs {opp.event.awayTeam}
              </p>
              <p className="text-sm text-slate-400">
                {opp.event.sport.title} · {opp.marketKey}
              </p>
              <p className="text-emerald-400 mt-2">
                Ganancia garantizada: {Number(opp.guaranteedProfit).toFixed(2)}%
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3 text-blue-400">
          Value Bets bet365 ({valueBets.length})
        </h2>
        {valueBets.length === 0 && (
          <p className="text-slate-400 text-sm">Sin value bets activos.</p>
        )}
        <div className="space-y-3">
          {valueBets.map((opp) => (
            <div key={opp.id} className="border border-slate-800 rounded-lg p-4 bg-slate-900">
              <p className="font-medium">
                {opp.event.homeTeam} vs {opp.event.awayTeam}
              </p>
              <p className="text-sm text-slate-400">
                {opp.event.sport.title} · {opp.marketKey}
              </p>
              <p className="text-blue-400 mt-2">
                EV: {(Number(opp.expectedValue) * 100).toFixed(1)}% · Kelly recomendado:{" "}
                {(Number(opp.kellyFraction) * 100).toFixed(2)}% de banca
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
