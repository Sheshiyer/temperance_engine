import { describe, expect, test } from "bun:test";

import {
  POLICY_VERSION,
  planRouting,
  reduceObservations,
  type ObservationState,
  type RoutingInput,
} from "./routing-policy";

const candidates: RoutingInput["candidates"] = [
  {
    backend: "command-code",
    model: "MiniMaxAI/MiniMax-M3",
    static_rank: 0,
    tier: "balanced",
    strength: "frontier",
    context_window: "1M",
  },
  {
    backend: "grok",
    model: "grok-build",
    static_rank: 1,
    tier: "balanced",
    strength: "coding",
    context_window: "128k",
  },
  {
    backend: "kimi",
    model: "kimi-code/kimi-for-coding",
    static_rank: 2,
    tier: "deep",
    strength: "coding",
    context_window: "262k",
  },
];

function input(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    mode: "shadow",
    task_type: "balanced",
    now_ms: 1_000_000,
    candidates,
    observations: { version: 1, updated_at_ms: 900_000, backends: {} },
    ...overrides,
  };
}

describe("planRouting", () => {
  test("shadow records a proposal but executes static order", () => {
    const plan = planRouting(
      input({
        observations: {
          version: 1,
          updated_at_ms: 900_000,
          backends: {
            "command-code": { health: 0.1, consecutive_failures: 2 },
            grok: { health: 0.99, quota_remaining: 0.9 },
            kimi: { health: 0.7, quota_remaining: 0.6 },
          },
        },
      }),
    );

    expect(plan.policy_version).toBe(POLICY_VERSION);
    expect(plan.mode).toBe("shadow");
    expect(plan.decision_time_ms).toBe(1_000_000);
    expect(plan.diverged).toBeTrue();
    expect(plan.static_order.map((candidate) => candidate.backend)).toEqual([
      "command-code",
      "grok",
      "kimi",
    ]);
    expect(plan.proposed_order[0]?.backend).toBe("grok");
    expect(plan.selected_order.map((candidate) => candidate.backend)).toEqual([
      "command-code",
      "grok",
      "kimi",
    ]);
  });

  test("enforce ranks capability, health, and quota deterministically", () => {
    const frozen = input({
      mode: "enforce",
      task_type: "long-horizon",
      observations: {
        version: 1,
        updated_at_ms: 900_000,
        backends: {
          "command-code": { health: 0.4, quota_remaining: 0.2 },
          grok: { health: 0.8, quota_remaining: 0.8 },
          kimi: { health: 0.99, quota_remaining: 0.9 },
        },
      },
    });

    const first = planRouting(frozen);
    const second = planRouting(structuredClone(frozen));

    expect(first.proposed_order[0]?.backend).toBe("kimi");
    expect(first.selected_order).toEqual(first.proposed_order);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.plan_id).toMatch(/^rp_[a-f0-9]{16}$/);
    expect(first.input_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.correlation_id).toBe(`tc_${first.input_hash.slice(0, 24)}`);
    expect(first.correlation_id).toBe(second.correlation_id);
  });

  test("missing observations preserve the static order", () => {
    const plan = planRouting(
      input({ observations: { version: 1, updated_at_ms: 0, backends: {} } }),
    );

    expect(plan.status).toBe("no-observations");
    expect(plan.diverged).toBeFalse();
    expect(plan.proposed_order).toEqual(plan.static_order);
    expect(plan.selected_order).toEqual(plan.static_order);
  });

  test("forced overrides collapse to one candidate", () => {
    const plan = planRouting(
      input({
        mode: "enforce",
        forced: true,
        candidates: [candidates[2]],
      }),
    );

    expect(plan.selected_order).toEqual([candidates[2]]);
    expect(plan.candidates[0]?.reasons).toContain("explicit-override");
  });

  test("open circuits are excluded and cooldown permits a half-open probe", () => {
    const open = planRouting(
      input({
        mode: "enforce",
        observations: {
          version: 1,
          updated_at_ms: 900_000,
          backends: {
            "command-code": {
              health: 0.2,
              circuit_state: "open",
              cooldown_until_ms: 1_100_000,
            },
            grok: { health: 0.8 },
          },
        },
      }),
    );
    expect(open.selected_order.some((candidate) => candidate.backend === "command-code")).toBeFalse();
    expect(open.candidates.find((candidate) => candidate.backend === "command-code")?.eligible).toBeFalse();

    const cooldownElapsed = planRouting(
      input({
        mode: "enforce",
        now_ms: 1_200_000,
        observations: {
          version: 1,
          updated_at_ms: 900_000,
          backends: {
            "command-code": {
              health: 0.2,
              circuit_state: "open",
              cooldown_until_ms: 1_100_000,
            },
          },
        },
      }),
    );
    expect(cooldownElapsed.candidates.find((candidate) => candidate.backend === "command-code")?.effective_circuit_state).toBe("half_open");
    expect(cooldownElapsed.selected_order.some((candidate) => candidate.backend === "command-code")).toBeTrue();
  });

  test("all-open circuits resolve to unavailable instead of a phantom route", () => {
    const plan = planRouting(
      input({
        mode: "enforce",
        observations: {
          version: 1,
          updated_at_ms: 999_000,
          backends: Object.fromEntries(
            candidates.map(({ backend }) => [
              backend,
              { health: 0.1, circuit_state: "open", cooldown_until_ms: 2_000_000 },
            ]),
          ),
        },
      }),
    );

    expect(plan.status).toBe("unavailable");
    expect(plan.selected_order).toEqual([]);
  });

  test("an active half-open probe lease excludes duplicate probes", () => {
    const plan = planRouting(
      input({
        mode: "enforce",
        candidates: [candidates[0]],
        observations: {
          version: 1,
          updated_at_ms: 999_000,
          backends: {
            "command-code": {
              circuit_state: "open",
              cooldown_until_ms: 900_000,
              probe_claimed_until_ms: 1_500_000,
            },
          },
        },
      }),
    );

    expect(plan.status).toBe("unavailable");
    expect(plan.selected_order).toEqual([]);
  });

  test("stale observations preserve static order", () => {
    const plan = planRouting(
      input({
        mode: "enforce",
        now_ms: 2_000_000,
        observation_max_age_ms: 100_000,
        observations: {
          version: 1,
          updated_at_ms: 1_000_000,
          backends: {
            "command-code": { health: 0.01 },
            grok: { health: 1, quota_remaining: 1 },
          },
        },
      }),
    );

    expect(plan.status).toBe("no-observations");
    expect(plan.proposed_order).toEqual(plan.static_order);
    expect(plan.selected_order).toEqual(plan.static_order);
  });
});

describe("reduceObservations", () => {
  const empty: ObservationState = {
    version: 1,
    updated_at_ms: 0,
    backends: {},
  };

  test("three failures open a circuit and success closes it", () => {
    const opened = reduceObservations(
      empty,
      [
        { backend: "grok", status: "failed", duration_s: 2 },
        { backend: "grok", status: "failed", duration_s: 3 },
        { backend: "grok", status: "failed", duration_s: 4 },
      ],
      2_000_000,
    );

    expect(opened.backends.grok?.consecutive_failures).toBe(3);
    expect(opened.backends.grok?.circuit_state).toBe("open");
    expect(opened.backends.grok?.cooldown_until_ms).toBeGreaterThan(2_000_000);

    const closed = reduceObservations(
      opened,
      [{ backend: "grok", status: "ok", duration_s: 1 }],
      3_000_000,
    );
    expect(closed.backends.grok?.circuit_state).toBe("closed");
    expect(closed.backends.grok?.consecutive_failures).toBe(0);
    expect(closed.backends.grok?.success_count).toBe(1);
  });

  test("timeouts are recorded without poisoning backend health", () => {
    const state = reduceObservations(
      empty,
      [{ backend: "kimi", status: "timeout", duration_s: 30 }],
      4_000_000,
    );

    expect(state.backends.kimi?.timeout_count).toBe(1);
    expect(state.backends.kimi?.failure_count).toBe(0);
    expect(state.backends.kimi?.consecutive_failures).toBe(0);
    expect(state.backends.kimi?.circuit_state).toBe("closed");
  });

  test("optional quota and cost observations survive reduction", () => {
    const current: ObservationState = {
      version: 1,
      updated_at_ms: 1,
      backends: {
        kimi: { quota_remaining: 0.42, cost_efficiency: 0.75 },
      },
    };
    const state = reduceObservations(
      current,
      [{ backend: "kimi", status: "ok", duration_s: 2 }],
      5_000_000,
    );

    expect(state.backends.kimi?.quota_remaining).toBe(0.42);
    expect(state.backends.kimi?.cost_efficiency).toBe(0.75);
  });

  test("unrelated attempts do not refresh another backend's telemetry", () => {
    const current: ObservationState = {
      version: 1,
      updated_at_ms: 100,
      backends: {
        "command-code": { quota_remaining: 1, cost_efficiency: 1 },
      },
    };
    const state = reduceObservations(
      current,
      [{ backend: "grok", status: "ok", duration_s: 1 }],
      1_000_000,
    );

    expect(state.updated_at_ms).toBe(1_000_000);
    expect(state.backends["command-code"]?.quota_updated_at_ms).toBe(100);
    expect(state.backends["command-code"]?.cost_efficiency_updated_at_ms).toBe(100);

    const plan = planRouting(
      input({
        mode: "enforce",
        now_ms: 1_000_000,
        observation_max_age_ms: 1_000,
        observations: state,
      }),
    );
    expect(plan.candidates.find(({ backend }) => backend === "command-code")?.factors.quota).toBe(0.5);
    expect(plan.candidates.find(({ backend }) => backend === "command-code")?.factors.cost_efficiency).toBe(0.5);
  });

  test("empty reductions do not make stale observations look fresh", () => {
    const current: ObservationState = {
      version: 1,
      updated_at_ms: 100,
      backends: { grok: { health: 0.9 } },
    };

    expect(reduceObservations(current, [], 1_000_000).updated_at_ms).toBe(100);
  });

  test("attempts reduce by completion time instead of index order", () => {
    const state = reduceObservations(
      empty,
      [
        { backend: "grok", status: "ok", duration_s: 1, finished_at_ms: 400 },
        { backend: "grok", status: "failed", duration_s: 1, finished_at_ms: 100 },
        { backend: "grok", status: "failed", duration_s: 1, finished_at_ms: 200 },
        { backend: "grok", status: "failed", duration_s: 1, finished_at_ms: 300 },
      ],
      5_000_000,
    );

    expect(state.backends.grok?.circuit_state).toBe("closed");
    expect(state.backends.grok?.consecutive_failures).toBe(0);
  });
});
