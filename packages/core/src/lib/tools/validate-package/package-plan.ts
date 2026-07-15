// package-plan.ts — a STRUKTURÁLT csomagterv. A validatePackage sikeres kimenete: ebből lesz
// a szerveren a data-package stream-part, a web UI-ban a csomag-összesítő kártya. Ugyanez a
// JSON megy a modellnek is (ToolOutcome.content) — egy igazságforrás, két fogyasztó.

export interface PackagePlanItem {
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PackagePlan {
  customerId: number;
  customerCode: string;
  customerName: string;
  budget: number;
  items: PackagePlanItem[];
  totalPrice: number;
  remaining: number;
}

/** A data-tool stream-part tartalma — a tool-chipek és a flow-lock közös nyelve. */
export interface ToolEventData {
  agent: 'orchestrator' | 'info' | 'package';
  toolName: string;
  summary: string | null;
  isError: boolean;
  rowCount: number | null;
  /** delegate módban a beágyazott info-agent hívásai true-val — a UI behúzva rajzolja. */
  nested: boolean;
  /** csak routeTo-nál: hová megy a labda. */
  targetAgent?: 'info' | 'package';
  /** csak routeTo-nál: a döntés indoka. */
  reason?: string;
}
