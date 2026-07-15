import { Button } from '@/components/ui/button';
import type { PackagePlan } from '@/lib/message-parts';

// package-summary.tsx — a CSOMAG-ÖSSZESÍTŐ KÁRTYA a data-package partból. A két gomb csak
// egy előre írt chat-üzenetet küld be — nincs külön API-út: a megerősítés is a
// beszélgetésben él, az agent dönt rá tool-hívással (savePackage / vissza a kérdezgetésbe).

interface PackageSummaryProps {
  plan: PackagePlan;
  disabled: boolean;
  onConfirm: () => void;
  onModify: () => void;
}

const huf = (n: number): string => `${n.toLocaleString('hu-HU')} Ft`;

export function PackageSummary({ plan, disabled, onConfirm, onModify }: PackageSummaryProps) {
  return (
    <div data-testid="package-summary" className="my-2 rounded-lg border bg-background/60 p-3 text-sm">
      <p className="mb-2 font-medium">
        📦 Csomagterv — {plan.customerName} ({plan.customerCode})
      </p>
      <table className="w-full text-xs">
        <tbody>
          {plan.items.map((item) => (
            <tr key={item.productId} className="border-b last:border-0">
              <td className="py-1">{item.name}</td>
              <td className="py-1 text-right">{item.qty} db</td>
              <td className="py-1 text-right">{huf(item.unitPrice)}</td>
              <td className="py-1 text-right font-medium">{huf(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-muted-foreground mt-2 flex justify-between text-xs">
        <span>Összesen: <strong className="text-foreground">{huf(plan.totalPrice)}</strong></span>
        <span>Keret: {huf(plan.budget)} · marad: {huf(plan.remaining)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={disabled} onClick={onConfirm}>
          Rendben, mentsd
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onModify}>
          Módosítanék
        </Button>
      </div>
    </div>
  );
}
