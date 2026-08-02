import type { Plugin } from "@opencode-ai/plugin";
import { assertLiveModel, getLiveModelIds } from "./OmniRouteCatalogGuardCore";

const OmniRouteCatalogGuard: Plugin = async () => ({
  "chat.params": async (input, _output) => {
    if (!input?.model || !["omniroute", "temperance"].includes(input.model.providerID)) return;

    const configuredBaseUrl =
      typeof input.provider?.options?.baseURL === "string"
        ? input.provider.options.baseURL
        : process.env.TEMPERANCE_OMNIROUTE_BASE_URL ||
          (input.model.providerID === "temperance"
            ? "http://127.0.0.1:20129/v1"
            : "http://127.0.0.1:20128/v1");
    const liveModelIds = await getLiveModelIds(configuredBaseUrl);
    if (input.model.id) assertLiveModel(input.model.id, liveModelIds);
  },
});

export default OmniRouteCatalogGuard;
