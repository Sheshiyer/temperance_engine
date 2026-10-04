import {
  NINE_ROUTER_PACKAGE,
  OMNIROUTE_PACKAGE,
  ONBOARDING_CATALOG_SCHEMA,
  ONBOARDING_PROFILE_SCHEMA,
  type OnboardingCatalogV1,
  type OnboardingModule,
  type OnboardingProfileV1,
} from "./contracts.ts";

const OMNIROUTE_ORIGIN = `http://${OMNIROUTE_PACKAGE.listen_host}:${OMNIROUTE_PACKAGE.listen_port}`;

/**
 * `/api/health` is OmniRoute's own CLI liveness route. Probe it with GET, because not every server
 * handles HEAD. Accept 401 too: an install that enforces a management token answers 401 there, and
 * that still proves the router is up.
 */
function omnirouteLivenessProbe(): { method: "GET"; accept_status: number[] } {
  return { method: "GET", accept_status: [200, 401] };
}

/**
 * Generic profile used when no personalized overlay is selected. Its only values are the
 * upstream loopback defaults for a single-host install where OmniRoute runs on this machine.
 */
export function createCoreOnboardingProfile(): OnboardingProfileV1 {
  return {
    schema: ONBOARDING_PROFILE_SCHEMA,
    version: { major: 1, minor: 0 },
    id: "temperance-portable-core",
    variables: {
      OMNIROUTE_HEALTH_URL: `${OMNIROUTE_ORIGIN}/api/health`,
      OMNIROUTE_MEMORY_URL: `${OMNIROUTE_ORIGIN}/api/memory`,
      OMNIROUTE_LOCAL_HEALTH_URL: `${OMNIROUTE_ORIGIN}/api/health`,
    },
    secret_references: {},
    preselected_modules: [],
    routing_aliases: [],
    project_enrollments: [],
  };
}

/**
 * Portable organ registry. Each organ is an onboarding module with an `organ` block, so the same
 * planner drives `temperance onboard` (selection) and `temperance onboard --doctor` (on/off status).
 * Hostnames, mount identities, private LaunchAgent labels and display names are profile variables.
 */
export function createCoreOnboardingCatalog(): OnboardingCatalogV1 {
  const modules: OnboardingModule[] = [{
    id: "provider.omniroute",
    title: "OmniRoute router",
    summary: "Model gateway, combo authority and memory store that every client on this host routes through; hosted on a cloud runner or run locally.",
    preselection: "selected",
    depends_on: [],
    requires: [{
      id: "omniroute-health",
      kind: "http-health",
      url_variable: "OMNIROUTE_HEALTH_URL",
      ...omnirouteLivenessProbe(),
    }],
    // A single-host install gets its router from provider.omniroute-local.
    guided_installs: [],
    organ: { tier: "required", group: "router", host_role: "operator-mac", host_role_variable: "OMNIROUTE_HOST_ROLE", public_url_variable: "OMNIROUTE_PUBLIC_URL" },
  }, {
    id: "provider.omniroute-local",
    title: "Local OmniRoute",
    summary: "OmniRoute run on this machine as a LaunchAgent: the router itself on a single-host install, or a cold fallback when the router is hosted.",
    preselection: "available",
    depends_on: [],
    requires: [{
      id: "omniroute-binary",
      kind: "binary",
      executable: OMNIROUTE_PACKAGE.executable,
      version: { exact: OMNIROUTE_PACKAGE.version, argv: ["--version"] },
    }, {
      id: "omniroute-launch-agent",
      kind: "launch-agent",
      label: OMNIROUTE_PACKAGE.launch_agent_label,
    }, {
      id: "omniroute-local-health",
      kind: "http-health",
      url_variable: "OMNIROUTE_LOCAL_HEALTH_URL",
      ...omnirouteLivenessProbe(),
    }],
    guided_installs: [{
      id: "install-omniroute",
      label: `Install OmniRoute ${OMNIROUTE_PACKAGE.version}`,
      kind: "command",
      argv: ["bun", "add", "--global", `${OMNIROUTE_PACKAGE.name}@${OMNIROUTE_PACKAGE.version}`],
    }, {
      id: "omniroute-launch-agent",
      label: "Install the OmniRoute LaunchAgent (run from the Temperance Engine checkout)",
      kind: "command",
      argv: ["scripts/omniroute-autostart-launchd.sh", "install"],
    }],
    organ: { tier: "modular", group: "router", host_role: "operator-mac" },
  }, {
    id: "memory.temperance",
    title: "Temperance memory",
    summary: "Durable agent memory served by the router's memory API; read by session context and written by memory sync.",
    preselection: "selected",
    depends_on: ["provider.omniroute"],
    requires: [{
      id: "omniroute-admin-secret",
      kind: "keychain-secret",
      secret_reference: "OMNIROUTE_ADMIN",
    }, {
      id: "omniroute-memory-route",
      kind: "http-health",
      url_variable: "OMNIROUTE_MEMORY_URL",
      // The memory route answers 401 until the admin session logs in; 401 proves the route exists.
      accept_status: [200, 401],
    }],
    guided_installs: [{
      id: "sync-memory",
      label: "Sync PAI memories into OmniRoute (run from the Temperance Engine checkout)",
      kind: "command",
      argv: ["scripts/omniroute-memory-sync.sh", "--apply"],
    }],
    organ: { tier: "required", group: "memory", host_role: "operator-mac", host_role_variable: "OMNIROUTE_HOST_ROLE" },
  }, {
    id: "storage.knowledge-volume",
    title: "Knowledge volume",
    summary: "External volume that holds the knowledge vault; verified by mount path, volume identity and vault subtree.",
    preselection: "available",
    depends_on: [],
    requires: [{
      id: "knowledge-volume-mount",
      kind: "mount",
      mount_path_variable: "KNOWLEDGE_VOLUME_ROOT",
      expected_uuid_variable: "KNOWLEDGE_VOLUME_UUID",
      required_relative_path_variable: "KNOWLEDGE_VAULT_RELATIVE_PATH",
    }],
    guided_installs: [],
    organ: { tier: "modular", group: "knowledge", host_role: "operator-mac", title_variable: "KNOWLEDGE_VOLUME_NAME" },
  }, {
    id: "tunnel.knowledge-vault",
    title: "Knowledge vault tunnel",
    summary: "Read-only WebDAV view of the knowledge vault, published through an identity-protected tunnel for remote agents.",
    preselection: "available",
    depends_on: ["storage.knowledge-volume"],
    requires: [{
      id: "knowledge-vault-server-agent",
      kind: "launch-agent",
      label_variable: "KNOWLEDGE_VAULT_SERVER_AGENT",
    }, {
      id: "knowledge-vault-server-port",
      kind: "tcp-port",
      port: 18730,
      port_variable: "KNOWLEDGE_VAULT_SERVER_PORT",
    }, {
      id: "knowledge-vault-tunnel-agent",
      kind: "launch-agent",
      label_variable: "KNOWLEDGE_VAULT_TUNNEL_AGENT",
    }],
    guided_installs: [],
    organ: { tier: "modular", group: "tunnel", host_role: "operator-mac", public_url_variable: "KNOWLEDGE_VAULT_PUBLIC_URL" },
  }, {
    id: "tunnel.temperance-memory",
    title: "Temperance memory tunnel",
    summary: "Publishes the local memory API to remote Temperance hosts through a tunnel connector.",
    preselection: "available",
    depends_on: ["memory.temperance"],
    requires: [{
      id: "memory-tunnel-agent",
      kind: "launch-agent",
      label_variable: "MEMORY_TUNNEL_AGENT",
    }, {
      id: "memory-tunnel-public",
      kind: "http-health",
      url_variable: "MEMORY_TUNNEL_PUBLIC_URL",
      method: "GET",
      accept_status: [200, 301, 302, 307, 308, 401],
    }],
    guided_installs: [],
    organ: { tier: "modular", group: "tunnel", host_role: "operator-mac", public_url_variable: "MEMORY_TUNNEL_PUBLIC_URL" },
  }, {
    id: "integration.hermes-a2a",
    title: "Hermes A2A",
    summary: "Agent-to-agent endpoint on this host's Hermes gateway, so a remote Hermes agent can hand it tasks.",
    preselection: "available",
    depends_on: [],
    requires: [{
      id: "hermes-a2a-port",
      kind: "tcp-port",
      port: 7423,
      port_variable: "HERMES_A2A_PORT",
    }],
    guided_installs: [],
    organ: { tier: "modular", group: "integration", host_role: "operator-mac" },
  }, {
    id: "tunnel.hermes-a2a",
    title: "Hermes A2A tunnel",
    summary: "Publishes the Hermes A2A endpoint through an identity-protected tunnel for remote Hermes agents.",
    preselection: "available",
    depends_on: ["integration.hermes-a2a"],
    requires: [{
      id: "hermes-a2a-tunnel-agent",
      kind: "launch-agent",
      label_variable: "HERMES_A2A_TUNNEL_AGENT",
    }],
    guided_installs: [],
    // No public probe: the identity proxy answers before the origin, so only the connector is checked here.
    organ: { tier: "modular", group: "tunnel", host_role: "operator-mac", public_url_variable: "HERMES_A2A_PUBLIC_URL" },
  }, {
    id: "integration.obsidian-rest",
    title: "Obsidian Local REST",
    summary: "Obsidian's Local REST API, so agents can read and write notes through the running Obsidian app.",
    preselection: "available",
    depends_on: [],
    requires: [{
      id: "obsidian-application",
      kind: "application",
      bundle_id: "md.obsidian",
    }, {
      id: "obsidian-rest-port",
      kind: "tcp-port",
      port: 27124,
      port_variable: "OBSIDIAN_REST_PORT",
    }],
    guided_installs: [],
    organ: { tier: "optional", group: "integration", host_role: "operator-mac" },
  }, {
    id: "tunnel.obsidian-rest",
    title: "Obsidian tunnel",
    summary: "Publishes Obsidian Local REST through an identity-protected tunnel so remote agents can use the open vault.",
    preselection: "available",
    depends_on: ["integration.obsidian-rest"],
    requires: [{
      id: "obsidian-tunnel-agent",
      kind: "launch-agent",
      label_variable: "OBSIDIAN_TUNNEL_AGENT",
    }],
    guided_installs: [],
    // No public probe: the identity proxy answers before the origin, so only the connector is checked here.
    organ: { tier: "optional", group: "tunnel", host_role: "operator-mac", public_url_variable: "OBSIDIAN_PUBLIC_URL" },
  }, {
    id: "integration.mail-mcp",
    title: "Apple Mail MCP",
    summary: "MCP server that exposes Apple Mail to agents.",
    preselection: "available",
    depends_on: [],
    requires: [{
      id: "mail-mcp-port",
      kind: "tcp-port",
      port: 20141,
      port_variable: "MAIL_MCP_PORT",
    }],
    guided_installs: [],
    organ: { tier: "optional", group: "integration", host_role: "operator-mac", public_url_variable: "MAIL_MCP_PUBLIC_URL" },
  }];
  return { schema: ONBOARDING_CATALOG_SCHEMA, version: { major: 1, minor: 0 }, modules };
}

/**
 * The retired 9Router provider. It is no longer part of the shipped catalog; it remains only so the
 * legacy `onboard --repair` flow and the 9Router guided-setup tooling keep a reviewed module to act on.
 */
export function createLegacyNineRouterCatalog(): OnboardingCatalogV1 {
  return {
    schema: ONBOARDING_CATALOG_SCHEMA,
    version: { major: 1, minor: 0 },
    modules: [{
      id: "provider.9router",
      title: "9Router (retired)",
      summary: "Retired local model gateway; replaced by OmniRoute.",
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
