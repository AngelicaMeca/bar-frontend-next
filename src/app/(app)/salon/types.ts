import type { ProcOutput } from "@/server/rpc";

export type Floor = ProcOutput<"floor.state">;
export type FloorTable = Floor["tables"][number];
export type FloorOrder = Floor["orders"][number];
