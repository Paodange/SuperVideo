export type AgentHealth = {
  service: "agent-worker";
  status: "ok";
};

export function getHealthStatus(): AgentHealth {
  return { service: "agent-worker", status: "ok" };
}

process.stdout.write(`${JSON.stringify(getHealthStatus())}\n`);
