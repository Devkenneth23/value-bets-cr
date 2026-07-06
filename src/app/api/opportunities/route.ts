import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  type: z.enum(["ARBITRAGE", "VALUE_BET"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.parse({
      type: searchParams.get("type") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    const opportunities = await prisma.opportunity.findMany({
      where: {
        isActive: true,
        ...(parsed.type && { type: parsed.type }),
        event: { commenceTime: { gt: new Date() } },
      },
      include: {
        event: {
          include: { sport: true },
        },
      },
      orderBy: [{ guaranteedProfit: "desc" }, { expectedValue: "desc" }],
      take: parsed.limit,
    });

    return NextResponse.json({ data: opportunities });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Parametros invalidos", details: error.errors },
        { status: 400 }
      );
    }
    console.error("[GET /api/opportunities]", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
