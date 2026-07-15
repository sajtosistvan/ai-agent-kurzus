import type { ModelMessage, UIMessage, UIMessageStreamWriter } from 'ai';
import {
  askAgent,
  getOrchestrationMode,
  runOrchestrated,
  type OrchestratorEvent,
} from '@plantbase/core';

// chat-stream.ts — a PROTOKOLL-TRANSZFORMÁCIÓ egyetlen fájlba zárva: a core callback-jei
// (onTextDelta, OrchestratorEvent) → AI SDK UI message stream chunkok. A main.ts handler
// vékony marad.
//
// KÉT ÚT:
//   off  → a MAI kódút, bájtra pontosan: askAgent + writer.merge(result.toUIMessageStream()).
//   router/delegate → runOrchestrated; a szöveg kézzel írt text-chunkokként megy ki, a
//     tool-/agent-/csomag-események data-* partokként. Minden data-part a mentett assistant
//     üzenet része lesz (onFinish menti), így újratöltéskor a badge/chip/kártya visszarajzolódik;
//     a modell-előzményből a stripDataParts (threads.ts) szűri ki őket.

export async function streamChat(args: {
  question: string;
  history: ModelMessage[];
  uiHistory: UIMessage[];
  writer: UIMessageStreamWriter;
}): Promise<void> {
  const mode = getOrchestrationMode();
  if (mode === 'off') {
    // VÁLTOZATLAN viselkedés — ez a sor korábban a main.ts-ben élt.
    await askAgent(args.question, {
      print: true,
      history: args.history,
      onStream: (result) => args.writer.merge(result.toUIMessageStream()),
    });
    return;
  }

  const { writer } = args;
  writer.write({ type: 'start' });

  // Szöveg-blokk könyvelés: data-part érkezésekor lezárjuk az épp nyitott text-blokkot,
  // így a kliens időrendben látja: badge → chipek → szöveg → (újabb chipek) → szöveg.
  let textCounter = 0;
  let openTextId: string | null = null;
  const closeText = (): void => {
    if (openTextId !== null) {
      writer.write({ type: 'text-end', id: openTextId });
      openTextId = null;
    }
  };
  const onTextDelta = (delta: string): void => {
    if (openTextId === null) {
      textCounter += 1;
      openTextId = `txt-${textCounter}`;
      writer.write({ type: 'text-start', id: openTextId });
    }
    writer.write({ type: 'text-delta', id: openTextId, delta });
  };
  const onEvent = (event: OrchestratorEvent): void => {
    closeText();
    if (event.type === 'agent') {
      writer.write({ type: 'data-agent', data: { agent: event.agent } });
    } else if (event.type === 'tool') {
      writer.write({ type: 'data-tool', data: event.data });
    } else {
      writer.write({ type: 'data-package', data: event.plan });
    }
  };

  try {
    await runOrchestrated(args.question, {
      mode,
      history: args.history,
      uiHistory: args.uiHistory,
      print: true,
      onTextDelta,
      onEvent,
    });
  } finally {
    closeText();
    writer.write({ type: 'finish' });
  }
}
