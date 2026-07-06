# Value Bets CR

Sistema personal de analisis de cuotas deportivas: deteccion de arbitraje y value bets contra bet365, usando The Odds API.

## Que hace

1. **Ingestion** (`odds-ingestion.service.ts`): trae cuotas de multiples casas via The Odds API
2. **Motor matematico** (`betting-math.service.ts`): calcula probabilidad implicita, EV, Kelly Criterion, arbitraje
3. **Detector** (`opportunity-detector.service.ts`): recorre eventos, agrupa cuotas, guarda oportunidades activas
4. **Dashboard** (`/dashboard`): muestra arbitraje y value bets ordenados por valor

## Setup local

```bash
# 1. Crear proyecto en Neon (gratis)
# Andar a https://console.neon.tech, crear proyecto, copiar connection string

# 2. Editar .env con nano
nano /home/claude/value-bets-cr/.env
# Pegar el DATABASE_URL real de Neon
# Generar un CRON_SECRET random:
openssl rand -hex 32

# 3. Instalar dependencias (ya hecho en el sandbox, repetir en tu maquina)
cd value-bets-cr
npm install

# 4. Generar cliente Prisma y correr migracion inicial
npx prisma generate
npx prisma migrate dev --name init

# 5. Correr ingestion manual para probar
npm run ingest

# 6. Levantar servidor de desarrollo
npm run dev
# Abrir http://localhost:3000/dashboard
```

## Deploy a Vercel

```bash
# 1. Subir a GitHub
cd value-bets-cr
git init
git add .
git commit -m "Initial commit: value-bets-cr"
gh repo create value-bets-cr --private --source=. --push

# 2. Conectar en Vercel
# vercel.com/new -> importar el repo

# 3. Variables de entorno en Vercel dashboard (Settings > Environment Variables):
# DATABASE_URL, ODDS_API_KEY, ODDS_API_BASE_URL, BANKROLL_TOTAL,
# KELLY_FRACTION_MULTIPLIER, CRON_SECRET
```

## Ingestion automatizada (GitHub Actions)

La ingestion de cuotas corre como GitHub Actions workflow programado (cada 15 min),
no como Vercel Cron, porque el proceso tarda ~4 minutos y Vercel Hobby tiene limite
de 10s por funcion serverless.

### GitHub Secrets requeridos

Configurar en **Settings > Secrets and variables > Actions** del repo:

| Secret | Descripcion |
|--------|-------------|
| `DATABASE_URL` | Connection string de Neon (postgresql://...) |
| `ODDS_API_KEY` | API key de The Odds API |
| `ODDS_API_BASE_URL` | Base URL de la API (https://api.the-odds-api.com/v4) |
| `BANKROLL_TOTAL` | Banca total en dolares (ej. 100) |
| `KELLY_FRACTION_MULTIPLIER` | Fraccion de Kelly (ej. 0.25) |

### Configurar via GitHub CLI

```bash
gh secret set DATABASE_URL --body "postgresql://user:pass@host/db?sslmode=require"
gh secret set ODDS_API_KEY --body "tu-api-key"
gh secret set ODDS_API_BASE_URL --body "https://api.the-odds-api.com/v4"
gh secret set BANKROLL_TOTAL --body "100"
gh secret set KELLY_FRACTION_MULTIPLIER --body "0.25"
```

### Ejecucion manual

```bash
gh workflow run ingest.yml
```

El endpoint `/api/odds` sigue disponible como trigger manual (protegido por `CRON_SECRET`),
pero ya no tiene cron automatico en Vercel.

## Ajustar deportes monitoreados

Editar `DEFAULT_SPORT_KEYS` en `src/services/odds-ingestion.service.ts`. Lista completa de sport keys disponibles en:
https://the-odds-api.com/sports-odds-data/sports-apis.html

## Ajustar tu banca y agresividad de Kelly

En `.env`:
- `BANKROLL_TOTAL`: tu banca total en dolares
- `KELLY_FRACTION_MULTIPLIER`: 0.25 = Kelly 1/4 (conservador, recomendado). 0.5 = Kelly 1/2 (mas agresivo). 1.0 = Kelly completo (alto riesgo si el edge estimado esta mal)

## Limitaciones honestas

- El consenso de mercado usado para EV es el promedio de las casas que The Odds API cubre en tu plan (EU/UK/US) — no es "la probabilidad real", es una aproximacion basada en el mercado
- Arbitraje requiere ejecutar las apuestas en simultaneo en ambas casas antes de que las cuotas cambien — ventanas tipicas de segundos a pocos minutos
- Plan Starter de The Odds API: 500 credits/mes. Cada llamada a `/odds` consume creditos segun regiones x mercados. Con el cron cada 15 min y 8 deportes configurados, revisa tu consumo en el dashboard de The Odds API para no quedarte sin credits a mitad de mes
