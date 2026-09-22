export type HealthStatus = {
  service: string;
  status: "ok" | "error";
};

export * from "./agent-protocol";
export * from "./core-rpc";
export * from "./diagnostics-protocol";
export * from "./redaction-fixtures";
export * from "./timeline-ir";
export * from "./provider-contract";
export * from "./tts-contract";
export * from "./image-contract";
export * from "./remotion-contract";
export * from "./recruitment-template-contract";
export * from "./script-storyboard-contract";
export * from "./video-assembly-contract";
export * from "./generation-fallback-contract";
