import type { OnboardingPlanV1 } from "./contracts.ts";
import type { NineRouterRoutingSurface } from "./nine-router-provider-capabilities.ts";

export type OnboardingPageId = "overview" | "modules" | "routing" | "projects" | "integrations" | "review";
export interface OnboardingViewRow { id: string; title: string; status: "eligible" | "blocked" | "not-selected"; blocked_reasons: string[]; guidance: string[]; }
export interface OnboardingViewPage { id: OnboardingPageId; title: string; rows: OnboardingViewRow[]; }
export interface OnboardingViewModel {
  title: string; summary: string; mode: OnboardingPlanV1["operating_mode"]; dry_run: boolean;
  profile_id: string; rows: OnboardingViewRow[]; pages: OnboardingViewPage[]; confirmation: "required";
}

function madaraState(rows: OnboardingViewRow[]): { label: string; status: OnboardingViewRow["status"]; reasons: string[] } {
  const madara = rows.find((row) => row.id === "storage.madara");
  if (!madara) return { label: "not registered", status: "not-selected", reasons: [] };
  if (madara.status === "eligible") return { label: "verified", status: "eligible", reasons: [] };
  if (madara.status === "not-selected") return { label: "not selected", status: "not-selected", reasons: [] };
  if (madara.blocked_reasons.includes("MOUNT_ABSENT")) return { label: "absent · read-only degraded", status: "blocked", reasons: madara.blocked_reasons };
  if (madara.blocked_reasons.includes("MOUNT_UUID_MISMATCH")) return { label: "identity drifted", status: "blocked", reasons: madara.blocked_reasons };
  if (madara.blocked_reasons.includes("PATH_MISSING")) return { label: "canonical subtree drifted", status: "blocked", reasons: madara.blocked_reasons };
  return { label: "unverified", status: "blocked", reasons: madara.blocked_reasons };
}

function moduleRows(plan: OnboardingPlanV1): OnboardingViewRow[] {
  return plan.modules.map((module) => ({
    id: module.id, title: module.title, status: module.status,
    blocked_reasons: module.holds.map((hold) => hold.reason_code),
    guidance: module.guided_installs.map((install) => install.kind === "command" ? `${install.label}: ${install.argv.join(" ")}` : `${install.label}: ${install.url}`),
  }));
}

function routingRows(surface?: NineRouterRoutingSurface): OnboardingViewRow[] {
  if (!surface) return [{
    id: "routing.unbound",
    title: "9Router provider and alias fitting unavailable",
    status: "blocked",
    blocked_reasons: ["HOST_PROFILE_NOT_SELECTED"],
    guidance: ["Select a portable host profile and private host binding to inspect provider and semantic-alias options."],
  }];
  const providers = surface.provider_options.map((provider): OnboardingViewRow => ({
    id: `provider.${provider.id}`,
    title: `${provider.display_name} · ${provider.auth_kind}`,
    status: provider.state === "connected" ? "eligible" : "blocked",
    blocked_reasons: provider.hold_reason ? [provider.hold_reason] : [],
    guidance: [`9router provider id: ${provider.id}`, `model prefix: ${provider.alias}`, ...provider.guidance],
  }));
  const aliases = surface.alias_seats.map((seat): OnboardingViewRow => ({
    id: `alias.${seat.alias}`,
    title: `${seat.alias} · ${seat.state}`,
    status: seat.state === "ready" ? "eligible" : seat.state === "held" ? "blocked" : "not-selected",
    blocked_reasons: seat.hold_reason ? [seat.hold_reason] : [],
    guidance: seat.state === "held"
      ? ["Admit a provider in 9Router, refresh the live model catalog, then seat this alias."]
      : [`${surface.live_model_count} live provider model choices available through router-seat.`],
  }));
  return [...providers, ...aliases];
}

export function createOnboardingViewModel(plan: OnboardingPlanV1, routing?: NineRouterRoutingSurface): OnboardingViewModel {
  const rows = moduleRows(plan);
  const eligible = rows.filter((module) => module.status === "eligible").length;
  const blocked = rows.filter((module) => module.status === "blocked").length;
  const available = rows.filter((module) => module.status === "not-selected").length;
  const router = rows.find((row) => row.id === "provider.9router");
  const madara = madaraState(rows);
  const overview: OnboardingViewRow[] = [
    { id: "profile", title: `Active profile: ${plan.profile_id}`, status: "eligible", blocked_reasons: [], guidance: [] },
    { id: "9router", title: `9Router: ${router?.status ?? "not registered"}`, status: router?.status ?? "not-selected", blocked_reasons: router?.blocked_reasons ?? [], guidance: router?.guidance ?? [] },
    { id: "mount", title: `Madara: ${madara.label}`, status: madara.status, blocked_reasons: madara.reasons, guidance: [] },
  ];
  const projects: OnboardingViewRow[] = (plan.project_enrollments ?? []).map((project) => ({
    id: project.id, title: `${project.id} · ${project.approved ? "approved" : "pending approval"}`, status: project.approved ? "eligible" : "not-selected", blocked_reasons: [], guidance: [project.access],
  }));
  projects.push(...(plan.project_candidates ?? []).map((project) => ({
    id: project.id,
    title: `${project.display_name} · ${project.selectable === false || !project.path_present ? "unavailable" : "pending approval"}`,
    status: project.selectable === false || !project.path_present ? "blocked" as const : "not-selected" as const,
    blocked_reasons: project.selectable === false || !project.path_present ? ["PROJECT_PATH_UNAVAILABLE"] : [],
    guidance: [
      project.access,
      ...(project.portfolio_id ? [`portfolio: ${project.portfolio_id}`] : []),
      ...(project.mapping_status ? [`mapping: ${project.mapping_status}`] : []),
      ...(project.work_ids?.length ? [`work: ${project.work_ids.join(", ")}`] : []),
      ...(project.repository_candidates?.length ? project.repository_candidates.map((repository) => `repository candidate: ${repository}`) : [`repository: ${project.repository_identity}`]),
      `source: ${project.discovery_source}`,
    ],
  })));
  projects.push(...(plan.project_discovery_findings ?? []).map((finding) => ({
    id: `finding.${finding.source_id}.${finding.code.toLowerCase()}`,
    title: `${finding.source_id} · ${finding.message}`,
    status: "blocked" as const,
    blocked_reasons: [finding.code],
    guidance: [],
  })));
  const integrations = rows.filter((row) => row.blocked_reasons.some((reason) => reason.includes("APPLICATION")) || row.id.startsWith("integration."));
  const review: OnboardingViewRow[] = [{
    id: "operation-plan", title: `Operation plan · ${plan.install_order.length} modules`, status: plan.operating_mode === "blocked" ? "blocked" : "eligible",
    blocked_reasons: plan.modules.flatMap((module) => module.holds.map((hold) => `${module.id}:${hold.reason_code}`)),
    guidance: [
      `order: ${plan.install_order.join(" → ") || "none"}`,
      `digest: ${plan.plan_digest}`,
      "confirmation required before any separate cutover execution",
    ],
  }];
  for (const input of plan.configuration_inputs ?? []) {
    review.push({
      id: `configuration.${input.id}`,
      title: `Configuration input · ${input.id}`,
      status: "eligible",
      blocked_reasons: [],
      guidance: [`digest: ${input.digest}`, `${input.details.length} exact detail${input.details.length === 1 ? "" : "s"} bound into the plan`],
    });
    for (const [index, item] of input.details.entries()) {
      review.push({
        id: `configuration.${input.id}.detail.${index + 1}`,
        title: `${input.id} · detail ${index + 1} of ${input.details.length}`,
        status: "eligible",
        blocked_reasons: [],
        guidance: [item],
      });
    }
  }
  return {
    title: "Temperance V4 Onboarding", summary: `${eligible} eligible · ${blocked} blocked · ${available} available`, mode: plan.operating_mode,
    dry_run: plan.dry_run, profile_id: plan.profile_id, rows, confirmation: "required",
    pages: [
      { id: "overview", title: "Overview", rows: overview }, { id: "modules", title: "Modules", rows },
      { id: "routing", title: "Routing", rows: routingRows(routing) },
      { id: "projects", title: "Projects", rows: projects }, { id: "integrations", title: "Integrations", rows: integrations },
      { id: "review", title: "Review", rows: review },
    ],
  };
}

export function renderOnboardingText(plan: OnboardingPlanV1, routing?: NineRouterRoutingSurface): string {
  const view = createOnboardingViewModel(plan, routing);
  const lines = [`${view.title} · ${view.dry_run ? "READ-ONLY PLAN" : "COMMIT PLAN"}`, `profile: ${view.profile_id}`, `mode: ${view.mode}`, `summary: ${view.summary}`, `digest: ${plan.plan_digest}`, "MODULES"];
  for (const row of view.rows) {
    lines.push(`  [${row.status.toUpperCase()}] ${row.id} · ${row.title}`);
    for (const reason of row.blocked_reasons) lines.push(`    hold: ${reason}`);
    for (const guidance of row.guidance) lines.push(`    guided: ${guidance}`);
  }
  for (const input of plan.configuration_inputs ?? []) {
    lines.push(`CONFIGURATION ${input.id} · ${input.digest}`);
    for (const detail of input.details) lines.push(`  ${detail}`);
  }
  lines.push("ROUTING");
  for (const row of view.pages.find(({ id }) => id === "routing")?.rows ?? []) {
    lines.push(`  [${row.status.toUpperCase()}] ${row.id} · ${row.title}`);
    for (const reason of row.blocked_reasons) lines.push(`    hold: ${reason}`);
    for (const guidance of row.guidance) lines.push(`    guided: ${guidance}`);
  }
  lines.push("Review confirmation is required. No changes were made by this planning command.");
  return `${lines.join("\n")}\n`;
}
