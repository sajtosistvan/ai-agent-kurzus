// modell.ts — a modell-választás és a hozzá tartozó provider-beállítás EGY helyen,
// hogy a négy agent ne csússzon el egymástól.
//
// MIÉRT VAN KIKAPCSOLVA A THINKING (fontos, ne kapcsold vissza megfontolás nélkül):
// a Mastra model routerében a Claude alapból extended thinkinggel fut, és a gondolkodási
// blokk `reasoning` részként BEKERÜL a memóriába. Amikor egy következő körben visszajátsszuk
// a szálat — és pláne amikor a supervisor delegál egy al-agentnek —, az Anthropic API
// elutasítja a kérést:
//
//     messages.N: The final block in an assistant message cannot be `thinking`.
//
// Ettől a beszélgetés MÁSODIK köre elszáll: az al-agent hívása hibára fut, a supervisor
// pedig üres kézzel mentegetőzik. Egyfordulós használatban ez nem látszik, ezért csúszik át
// könnyen a teszteken. A thinking kikapcsolásával a szálban nem keletkezik reasoning-blokk,
// tehát nincs mit rosszul visszajátszani.
//
// AZ ÁRA: a nehezebb kérdéseknél elesünk a hosszabb belső gondolkodástól. A Plantbase
// feladataihoz (SQL-írás, tudásbázis-összegzés, csomag-terelés) ez nem hiányzik, cserébe
// gyorsabb és olcsóbb. Ha egyszer mégis kellene, a memóriában tárolt üzeneteket kell
// megtisztítani a reasoning-részektől, nem ezt a kapcsolót átbillenteni.

/** A termék-agentek modellje (Mastra model router alak). */
export const PLANTBASE_MODELL = 'anthropic/claude-sonnet-5';

/** Minden agent futtatási alapbeállítása. A `maxSteps`-et az agent felülírja. */
export const PLANTBASE_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: 'disabled' as const } },
};
