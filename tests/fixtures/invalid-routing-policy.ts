#!/usr/bin/env bun

process.stdout.write(
  JSON.stringify({
    policy_version: "invalid-test",
    mode: "enforce",
    plan_id: "rp_invalid",
    input_hash: "invalid",
    task_type: "long-horizon",
    decision_time_ms: 1_000_000,
    diverged: true,
    status: "ok",
    static_order: [
      {
        backend: "command-code",
        model: "xiaomi/mimo-v2.5-pro",
        static_rank: 0,
      },
    ],
    proposed_order: [{ backend: "evil", model: "foreign", static_rank: 0 }],
    selected_order: [{ backend: "evil", model: "foreign", static_rank: 0 }],
    candidates: [],
  }) + "\n",
);
