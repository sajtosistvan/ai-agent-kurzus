import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  loadConfig,
  ConfigError,
  closeReadOnlyPool,
  closePrisma,
} from '@plantbase/core';
import { buildPlantbaseServer, TOOL_NAMES } from './plantbase-server.js';

// mcp/http.ts — UGYANAZ a szerver, másik transporton: streamable HTTP.
//
//   main.ts (stdio)  →  a host INDÍTJA a folyamatot a te gépeden. Egy felhasználó, egy gép.
//   http.ts (HTTP)   →  a szerver a NETEN fut, a host CSATLAKOZIK hozzá. Bárki, URL-lel.
//
// A `plantbase-server.ts` egyetlen sorát sem kellett hozzányúlni. Ez az MCP lényege: a
// képességek (toolok) és a szállítás külön rétegek.
//
// STATELESS MÓD: kérésenként ÚJ szervert és transportot építünk (`sessionIdGenerator: undefined`).
// Több példány mögött (Railway skálázás) így nincs ragadós munkamenet, amit egy másik konténer
// nem ismerne. Cserébe a szerver nem tud a kliens felé magától üzenni — nekünk ez nem hiányzik.
//
// BIZTONSÁG — amit tudni kell erről a végpontról:
//   • CAPABILITY URL: ha az MCP_PUBLIC_TOKEN be van állítva, a token az ÚTVONAL része
//     (/mcp/<token>). A Claude connector-felületén nem lehet saját fejlécet megadni — vagy OAuth,
//     vagy semmi —, ezért a titok az URL-be kerül. Ez nem OAuth: aki látja a linket, hívhatja.
//     Kurzusra pont jó (kiosztod, óra után törlöd), éles termékhez OAuth kell.
//   • Az ask_plantbase MODELLT HÍV, tehát minden hívás a mi API-kulcsunkat költi. Ezért van
//     rate limit, és ezért kell a tokent forgatni, ha kikerül.
//   • A DB felé minden változatlanul read-only (szerepkör + SELECT-guard + read-only tranzakció).

// A 3001 a chat-szerveré, a 4200 a webé — az MCP a 3010-en fut helyben. Railway-en a PORT-ot
// a platform adja, ez csak a fejlesztői alapérték.
const DEFAULT_PORT = 3010;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 60;

/** A publikus token — ha nincs megadva, a végpont NYITOTT (csak zárt hálón / demóban legyen az). */
const publicToken = process.env.MCP_PUBLIC_TOKEN?.trim() ?? '';

function requestPath(): string {
  return publicToken === '' ? '/mcp' : `/mcp/${publicToken}`;
}

/** Egy MCP-kérés kiszolgálása: friss szerver + friss transport, majd mindkettő eldobva. */
async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = buildPlantbaseServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  // A kérés végén takarítunk: a lezárás sorrendje számít (előbb a transport, aztán a szerver).
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`plantbase-mcp-http: kérés-hiba — ${message}\n`);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Belső hiba a szerveren.' },
        id: null,
      });
    }
  }
}

function main(): void {
  try {
    loadConfig();
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      process.stderr.write(`plantbase-mcp-http: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = express();

  app.use(express.json({ limit: '1mb' }));
  // A böngészőből induló MCP-kliensek a session- és protokoll-fejléceket is olvassák.
  app.use(
    cors({
      exposedHeaders: ['mcp-session-id', 'mcp-protocol-version'],
      allowedHeaders: ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'accept'],
    }),
  );
  app.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Túl sok kérés — próbáld pár perc múlva.' },
    }),
  );

  // Railway health check — a Postgres/modell felé NEM nyúl, csak azt jelzi, hogy él a folyamat.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', tools: TOOL_NAMES });
  });

  // Az MCP maga: POST a kérésekhez, GET/DELETE a stream-hez és a lezáráshoz.
  app.all(requestPath(), (req, res) => void handleMcpRequest(req, res));

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const httpServer = app.listen(port, () => {
    process.stdout.write(
      `plantbase-mcp-http: figyel a ${port} porton, útvonal: ${requestPath()}\n` +
        (publicToken === ''
          ? '⚠️  MCP_PUBLIC_TOKEN nincs beállítva — a végpont NYITOTT.\n'
          : ''),
    );
  });

  // Foglalt port / jogosultsági hiba: hangosan bukjunk el, ne csendben (a Railway a nem-nulla
  // kilépési kódból tudja, hogy a deploy elszállt).
  httpServer.on('error', (error: Error) => {
    process.stderr.write(`plantbase-mcp-http: nem indult el — ${error.message}\n`);
    process.exit(1);
  });

  const shutdown = (): void => {
    httpServer.close(() => {
      void Promise.allSettled([closeReadOnlyPool(), closePrisma()]).then(() =>
        process.exit(0),
      );
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
