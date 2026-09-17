import { expect, test } from "bun:test";

import { parseNineRouterSeatingArgs } from "../src/onboarding/nine-router-seating-cli-args.ts";

test("9router seating arguments require one portable profile and private binding", () => {
  expect(parseNineRouterSeatingArgs([
    "--host-profile", "/portable/noesis.json",
    "--host-binding", "/private/host.json",
    "--intent", "/private/intent.json",
    "--output", "/private/setup.json",
    "--tui",
  ])).toEqual({
    hostProfilePath: "/portable/noesis.json",
    hostBindingPath: "/private/host.json",
    intentPath: "/private/intent.json",
    outputPath: "/private/setup.json",
    gatewayReferenceId: undefined,
    gatewayKeyName: undefined,
    json: false,
    tui: true,
  });
  expect(parseNineRouterSeatingArgs([
    "--host-profile", "/portable/noesis.json",
    "--host-binding", "/private/host.json",
    "--gateway-reference", "NINE_ROUTER_GATEWAY_KEY",
    "--output", "/private/setup.json",
    "--tui",
  ])).toMatchObject({
    gatewayReferenceId: "NINE_ROUTER_GATEWAY_KEY",
    gatewayKeyName: "Temperance",
    intentPath: undefined,
  });
  expect(() => parseNineRouterSeatingArgs(["--host-profile", "/portable/noesis.json"])).toThrow("NINE_ROUTER_SEATING_ARGUMENT_INVALID");
  expect(parseNineRouterSeatingArgs([
    "--host-profile", "/portable/noesis.json",
    "--host-binding", "/private/host.json",
    "--json",
  ])).toMatchObject({ json: true, tui: false });
  expect(() => parseNineRouterSeatingArgs([
    "--host-profile", "/portable/noesis.json",
    "--host-binding", "/private/host.json",
    "--intent", "/private/intent.json",
    "--output", "/private/setup.json",
    "--tui", "--json",
  ])).toThrow("NINE_ROUTER_SEATING_ARGUMENT_INVALID");
  expect(() => parseNineRouterSeatingArgs([
    "--host-profile", "/portable/noesis.json",
    "--host-binding", "/private/host.json",
    "--intent", "/private/intent.json",
  ])).toThrow("NINE_ROUTER_SEATING_ARGUMENT_INVALID");
  expect(() => parseNineRouterSeatingArgs([
    "--host-profile", "/portable/noesis.json",
    "--host-binding", "/private/host.json",
    "--intent", "/private/intent.json",
    "--gateway-reference", "NINE_ROUTER_GATEWAY_KEY",
    "--output", "/private/setup.json",
  ])).toThrow("NINE_ROUTER_SEATING_ARGUMENT_INVALID");
});
