# Estado del proyecto: value-bets-cr

Sistema personal de analisis de cuotas deportivas (arbitraje, EV, Kelly Criterion) para uso de Kenneth Moreno.

**Repo:** https://github.com/Devkenneth23/value-bets-cr (publico)
**Stack:** Next.js 14 + Prisma + PostgreSQL (Neon) + The Odds API + Vercel + GitHub Actions

---

## Arquitectura actual

- **Frontend + API routes:** Next.js en Vercel (plan Hobby, gratis)
- **Base de datos:** PostgreSQL en Neon (free tier, AWS us-east-1)
- **Ingestion de cuotas:** GitHub Actions (`.github/workflows/ingest.yml`), NO Vercel Cron
- **Fuente de datos:** The Odds API, plan Starter (500 credits/mes)

### Por que ingestion esta en GitHub Actions y no en Vercel Cron

El proceso de ingestion tarda ~4 minutos (latencia de red a Neon + llamadas
secuenciales a The Odds API). Vercel Hobby limita las funciones serverless a
10 segundos de ejecucion, asi que un cron ahi habria fallado siempre. GitHub
Actions permite hasta 6 horas por job y es gratis e ilimitado en repos
publicos, por eso el repo se hizo publico.

---

## Bugs de causa raiz resueltos

### 1. Falsos positivos de arbitraje (hasta 1700% de ganancia falsa)

**Causa:** The Odds API incluye automaticamente mercados con clave `h2h_lay`
para casas de intercambio (Betfair, Matchbook, Smarkets). Estas son cuotas de
apostar EN CONTRA de un resultado (logica de liability), no cuotas normales.
El codigo trataba `h2h_lay` igual que `h2h`, generando arbitrajes matematicamente
invalidos.

**Fix:** `src/services/odds-ingestion.service.ts`, dentro de `persistEvent` —
se descarta cualquier `market.key` que termine en `_lay` antes de persistir.

### 2. Value bets en cero (bet365 hardcodeado)

**Causa:** `checkValueBets` en `opportunity-detector.service.ts` buscaba
unicamente `bookmaker.key === "bet365"`. Se confirmo con curl directo a la API
que bet365 no esta disponible para esta cuenta en las ligas configuradas
(`"bookmakers": []`).

**Fix:** Generalizado para evaluar TODAS las casas disponibles contra el
consenso del mercado. Cada oportunidad guardada incluye que casa especifica
ofrece el value bet. Con esto se detectaron 1415 value bets reales entre 49
casas distintas.

### 3. Ingestion tomaba 45+ minutos

**Causa:** `persistEvent` hacia un `prisma.odds.create()` individual con
`await` secuencial por cada fila (potencialmente miles de round-trips de red
contra Neon en us-east-1).

**Fix:** Upserts de `Bookmaker` y `Market` cacheados en memoria durante toda
la corrida (no se repiten por evento). Escrituras de `Odds` batcheadas con
`createMany` por evento en vez de creates individuales.

**Resultado:** de 45+ min a ~4 min (~11x mas rapido).

### 4. `.gitignore` faltante, push rechazado por archivos grandes

**Causa:** no existia `.gitignore`. El primer intento de push incluyo
`node_modules` completo (10,971 archivos), con binarios de Next.js de 125MB
y 149MB que exceden el limite de 100MB de GitHub.

**Fix:** se confirmo que `.env` nunca llego a subirse (no hizo falta rotar
credenciales). Se borro el historial local (`rm -rf .git`, `git init` de
nuevo) y se hizo push limpio con `.gitignore` correcto desde el primer commit.

---

## Pendiente / bug activo sin resolver

**Sintoma:** `.github/workflows/ingest.yml` esta confirmado en el repo
(contenido correcto, 46 lineas, bien formado, visible via
`gh api repos/.../contents/.github/workflows`), Actions esta habilitado
(`"enabled": true`), pero:

```bash
gh api repos/Devkenneth23/value-bets-cr/actions/workflows
# devuelve: { "total_count": 0, "workflows": [] }
```

Un commit vacio para forzar reindexacion (`git commit --allow-empty`) no
resolvio el problema.

**Siguiente paso de diagnostico:**
1. Revisar directo en el navegador `https://github.com/Devkenneth23/value-bets-cr/actions`
   para ver si la web muestra algo distinto a la API cacheada de `gh`
2. Si tampoco aparece ahi, bajar el archivo crudo con curl desde
   `raw.githubusercontent.com` y compararlo byte a byte contra lo esperado,
   para descartar caracteres invisibles o problema de encoding que `git show`
   no estaria reportando

```bash
curl -s https://raw.githubusercontent.com/Devkenneth23/value-bets-cr/master/.github/workflows/ingest.yml | xxd | head -20
```

---

## GitHub Secrets configurados

Ya configurados via `gh secret set` (nombres, no valores, por seguridad):

- `DATABASE_URL`
- `ODDS_API_KEY`
- `ODDS_API_BASE_URL`
- `BANKROLL_TOTAL`
- `KELLY_FRACTION_MULTIPLIER`

---

## Pendiente para deploy completo en Vercel

1. Resolver el bug de indexacion del workflow (arriba)
2. Confirmar que el workflow corre solo cada 15 min sin intervencion manual
3. `vercel link` y `vercel env add` para las mismas variables (mas
   `CRON_SECRET`) en el proyecto de Vercel
4. `vercel --prod` para el deploy final
5. Verificar `/dashboard` en produccion mostrando oportunidades reales

---

## Convenciones del proyecto (para mantener en cualquier cambio futuro)

- TypeScript estricto, sin `any`
- Service layer pattern (logica en `src/services/`, no en routes)
- Zod para validar toda respuesta externa (`src/types/odds-api.ts`)
- Comentarios en espanol explicando el porque de decisiones no obvias
- Kelly fraccionado (1/4) por defecto, no Kelly completo, para evitar
  sobreapuesta por errores de estimacion del edge
