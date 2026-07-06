import { OddsIngestionService } from "@/services/odds-ingestion.service";
import { OpportunityDetectorService } from "@/services/opportunity-detector.service";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("Sincronizando deportes activos...");
  const sportsCount = await OddsIngestionService.syncActiveSports();
  console.log(`Deportes sincronizados: ${sportsCount}`);

  console.log("Ingiriendo cuotas...");
  const ingestionResults = await OddsIngestionService.ingestAllConfiguredSports();
  console.table(ingestionResults);

  console.log("Detectando oportunidades...");
  const detection = await OpportunityDetectorService.detectAll();
  console.log("Resultado:", detection);
}

main()
  .catch((error) => {
    console.error("Error en ingestion:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
