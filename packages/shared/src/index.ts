export type HealthStatus = {
  service: string;
  status: "ok" | "error";
};

export * from "./agent-protocol";
export * from "./core-rpc";
