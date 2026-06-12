const port = Number(process.env.TEMPERANCE_PULSE_PORT || "31337");
const peonScript = process.env.PEON_SCRIPT || `${process.env.HOME}/.claude/hooks/peon-ping/peon.sh`;

const phasePacks: Record<string, string> = {
  native: "nier-2b",
  algorithm: "nier-2b",
  observe: "glados",
  think: "hal_2001",
  plan: "jarvis-mk2",
  build: "peon",
  execute: "nier-2b",
  verify: "cortana",
  learn: "sc_kerrigan",
};

function phaseFromMessage(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("native mode")) return "native";
  if (lower.includes("entering the algorithm")) return "algorithm";
  for (const phase of Object.keys(phasePacks)) {
    if (lower.includes(`entering the ${phase} phase`)) return phase;
  }
  return null;
}

async function playPeon(phase: string) {
  const pack = phasePacks[phase] || "nier-2b";
  if (typeof Bun === "undefined") {
    return { played: false, pack, reason: "bun-runtime-required" };
  }
  const proc = Bun.spawn([peonScript, "--pack", pack, "--category", phase === "native" || phase === "algorithm" ? "session.start" : "task.acknowledge"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { played: code === 0, pack, code };
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, compatibility: true, port });
    }
    if (url.pathname !== "/notify" || req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    let body: { message?: string } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, error: "invalid-json" }, { status: 400 });
    }
    const message = body.message || "";
    const phase = phaseFromMessage(message);
    if (!phase) {
      return Response.json({ ok: true, compatibility: true, played: false, forwarded: false });
    }
    const peon = await playPeon(phase);
    return Response.json({ ok: true, compatibility: true, phase, peon, forwarded: false });
  },
});

console.log(`temperance pulse compatibility server listening on ${server.hostname}:${server.port}`);
