import { prisma } from "@/lib/prisma";

async function main() {
  const arbitrageOpportunities = await prisma.opportunity.findMany({
    where: { type: "ARBITRAGE", isActive: true },
    include: { event: { include: { sport: true } } },
    orderBy: { guaranteedProfit: "desc" },
    take: 5,
  });

  for (const opp of arbitrageOpportunities) {
    console.log("----------------------------------------");
    console.log(`Evento: ${opp.event.homeTeam} vs ${opp.event.awayTeam}`);
    console.log(`Deporte: ${opp.event.sport.title} (${opp.event.sport.key})`);
    console.log(`Mercado: ${opp.marketKey}`);
    console.log(`Ganancia garantizada reportada: ${opp.guaranteedProfit}%`);
    console.log("Detalle:", JSON.stringify(opp.details, null, 2));

    const allOddsForEvent = await prisma.odds.findMany({
      where: { eventId: opp.event.id, market: { key: opp.marketKey } },
      include: { bookmaker: true, market: true },
      orderBy: { fetchedAt: "desc" },
    });

    console.log(`Total de filas de cuotas para este evento/mercado: ${allOddsForEvent.length}`);
    const uniqueBookmakers = [...new Set(allOddsForEvent.map((o) => o.bookmaker.key))];
    console.log(`Casas involucradas: ${uniqueBookmakers.join(", ")}`);
  }

  const eventCount = await prisma.event.count();
  const arbitrageCount = await prisma.opportunity.count({ where: { type: "ARBITRAGE" } });
  const valueBetCount = await prisma.opportunity.count({ where: { type: "VALUE_BET" } });
  const bet365Present = await prisma.bookmaker.findUnique({ where: { key: "bet365" } });

  console.log("==========================================");
  console.log(`Total eventos en DB: ${eventCount}`);
  console.log(`Total oportunidades ARBITRAGE: ${arbitrageCount}`);
  console.log(`Total oportunidades VALUE_BET: ${valueBetCount}`);
  console.log(`bet365 existe en tabla bookmakers: ${bet365Present ? "si" : "no"}`);

  if (!bet365Present) {
    const allBookmakerKeys = await prisma.bookmaker.findMany({ select: { key: true } });
    console.log("Casas disponibles en la DB:", allBookmakerKeys.map((b) => b.key).join(", "));
  }
}

main()
  .catch((error) => {
    console.error("Error en diagnostico:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
