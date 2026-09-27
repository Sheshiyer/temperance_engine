import {
  NINE_ROUTER_PACKAGE,
  ONBOARDING_CATALOG_SCHEMA,
  ONBOARDING_PROFILE_SCHEMA,
  type OnboardingCatalogV1,
  type OnboardingProfileV1,
} from "./contracts.ts";

/** Generic, value-free profile used when no personalized overlay is selected. */
export function createCoreOnboardingProfile(): OnboardingProfileV1 {
  return {
    schema: ONBOARDING_PROFILE_SCHEMA,
    version: { major: 1, minor: 0 },
    id: "temperance-portable-core",
    variables: {},
    secret_references: {},
    preselected_modules: ["provider.9router"],
    routing_aliases: [],
    project_enrollments: [],
  };
}

/** Portable modules that are meaningful without a user-specific overlay. */
export function createCoreOnboardingCatalog(): OnboardingCatalogV1 {
  return {
    schema: ONBOARDING_CATALOG_SCHEMA,
    version: { major: 1, minor: 0 },
    modules: [{
      id: "provider.9router",
      title: "9Router",
      summary: "Local model gateway and combo authority; successor to OmniRoute.",
      preselection: "available",
      depends_on: [],
      requires: [{
        id: "9router-binary",
        kind: "binary",
        executable: NINE_ROUTER_PACKAGE.executable,
        version: { exact: NINE_ROUTER_PACKAGE.version, argv: ["--version"] },
      }, {
        id: "9router-management-state",
        kind: "9router-management",
        data_dir_variable: "NINE_ROUTER_DATA_DIR",
      }],
      guided_installs: [{
        id: "install-9router",
        label: `Install 9Router ${NINE_ROUTER_PACKAGE.version}`,
        kind: "command",
        argv: ["bun", "add", "--global", `${NINE_ROUTER_PACKAGE.name}@${NINE_ROUTER_PACKAGE.version}`],
        environment: { DATA_DIR: "${NINE_ROUTER_DATA_DIR}" },
      }],
      state_transition: {
        from_relative_path: NINE_ROUTER_PACKAGE.legacy_state_directory,
        to_relative_path: NINE_ROUTER_PACKAGE.current_state_directory,
        policy: "fresh-rebuild",
        copy_legacy_state: false,
      },
      runtime_contract: {
        owner: "temperance",
        launch_agent_label: "com.temperance.engine.9router",
        forbidden_launch_agent_label: "com.9router.autostart",
        listen_host: "127.0.0.1",
        listen_port: 20128,
        data_dir_variable: "NINE_ROUTER_DATA_DIR",
        node_executable_variable: "NINE_ROUTER_NODE_EXECUTABLE",
        cli_entrypoint_variable: "NINE_ROUTER_CLI_ENTRYPOINT",
        path_variable: "NINE_ROUTER_PATH",
        log_directory_variable: "NINE_ROUTER_LOG_DIR",
        argv: ["--tray", "--host", "127.0.0.1", "--no-browser", "--skip-update"],
        run_at_load: true,
        keep_alive: true,
        management_auth: {
          header: "x-9r-cli-token",
          derivation: "data-dir-machine-secret",
          machine_id_relative_path: "machine-id",
          secret_relative_path: "auth/cli-secret",
          secret_mode: "0600",
          persist_derived_token: false,
        },
        api_contract: {
          keys: { collection: "/api/keys", item: "/api/keys/{id}" },
          cli_tool_settings: "/api/cli-tools/{tool}-settings",
          cli_tools: ["claude", "codex", "droid", "openclaw"],
          providers: "/api/providers",
          provider_item: "/api/providers/{id}",
          provider_create_fields: ["provider", "name", "apiKey"],
          combos: "/api/combos",
          combo_item: "/api/combos/{id}",
          combo_create_fields: ["name", "models"],
          gateway_key_policy: {
            capture: "one-time-to-keychain",
            profile_storage: "reference-only",
            receipt_storage: "redacted",
          },
        },
        cleanup_path_divergence: "doctor-required",
      },
    }],
  };
}
