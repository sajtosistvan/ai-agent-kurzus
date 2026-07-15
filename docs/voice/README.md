# Voice agent demók — 7. óra (eldobható)

Három élő demó a jegyzet 3., 4. és 6. pontjához. Plain HTML + mini Node szerver, OpenAI API-val.

## Futtatás

```bash
cd docs/voice
npm install
cp .env.example .env        # írd bele a saját OPENAI_API_KEY-edet
node --env-file=.env server.mjs
# → http://localhost:3777  (Chrome, engedélyezd a mikrofont)
```

> A kulcs a HELYI `.env` fájlban él (gitignore-olva) — a repóba soha nem kerül be,
> a `.env.example` csak a minta.

## A három demó

1. **Cascade latency waterfall** — nyomva tartott mikrofonnal beszélsz, a képernyőn
   lépésenként látszik az STT → LLM → TTS idő és a köztes szövegek.
   Tanulság: a latency a rétegek összege; a köztes szöveg = observability.

2. **Realtime + barge-in + VAD** — WebRTC kapcsolat a `gpt-realtime` modellhez.
   Kapcsoló: server VAD vs semantic VAD. Forgatókönyv az órára:
   - kérdezz valami hosszút, vágj közbe → a log mutatja a barge-in + truncation eseményeket
   - „a rendelésszámom… őőő… várj" → server VAD félbevág, semantic VAD kivár

3. **Waiting UX / filler** — az agent lassú (~6 mp) `getOrderStatus` toolt kap.
   Filler-instrukció KI: 6 mp néma csend (a számláló pirosan méri).
   Filler-instrukció BE: informatív kitöltő mondat, ugyanaz a latency elviselhető.
   Kérdés a demóhoz: „Hol tart a tizenkétezer-háromszáznegyvenötös rendelésem?"

## Megjegyzések

- A kulcs csak a szerveren van; a böngésző ephemeral tokent kap (10 perc élettartam).
- A tool-késleltetés és a rendelés-adat a `index.html`-ben fake (TOOL_DELAY_MS, FAKE_ORDER).
- Óra előtt érdemes egyszer végigpróbálni: a magyar STT/TTS minőség providerfüggő — ez maga is tananyag (8. jegyzetpont).
