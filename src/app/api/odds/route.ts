import { NextRequest, NextResponse } from "next/server";
import { OddsIngestionService } from "@/services/odds-ingestion.service";
import { OpportunityDetectorService } from "@/services/opportunity-detector.service";

// Protegido con CRON_SECRET para que solo Vercel Cron (o vos manualmente) lo pueda llamar
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const ingestionResults = await OddsIngestionService.ingestAllConfiguredSports();
    const detectionResults = await OpportunityDetectorService.detectAll();

    return NextResponse.json({
      data: {
        ingestion: ingestionResults,
        detection: detectionResults,
      },
    });
  } catch (error) {
    console.error("[GET /api/odds]", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
