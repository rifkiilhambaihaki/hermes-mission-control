import type { GatewayStatusData, ParserResult } from "./contracts.js";
import { parseKeyValueSection } from "./parser-helpers.js";
import { parserFailure, parserSuccess } from "./result-builders.js";
import { controlledEnum } from "./sanitization.js";

export function parseGatewayStatusText(text: string): ParserResult<"HERMES_GATEWAY_STATUS"> {
  const section = parseKeyValueSection(
    text,
    "Gateway Status",
    [
      "Process",
      "Process Mode",
      "System Service",
      "User Service",
      "Telegram",
      "Service Definition",
    ],
    [],
    ["PID", "Warning", "Suggested Command"],
  );
  if (!section.ok) return parserFailure("HERMES_GATEWAY_STATUS", section.errorCode);
  try {
    const data: GatewayStatusData = {
      processState: controlledEnum(section.values.Process ?? "", {
        running: "RUNNING",
        stopped: "STOPPED",
        absent: "STOPPED",
        unknown: "UNKNOWN",
      }),
      processIdentityConsistency: "UNKNOWN",
      processMode: controlledEnum(section.values["Process Mode"] ?? "", {
        managed: "MANAGED",
        manual: "MANUAL",
        unknown: "UNKNOWN",
      }),
      systemServiceState: controlledEnum(section.values["System Service"] ?? "", {
        active: "ACTIVE",
        inactive: "INACTIVE",
        unavailable: "UNAVAILABLE",
        unknown: "UNKNOWN",
      }),
      userServiceState: controlledEnum(section.values["User Service"] ?? "", {
        active: "ACTIVE",
        inactive: "INACTIVE",
        unavailable: "UNAVAILABLE",
        unknown: "UNKNOWN",
      }),
      managerCategory: "UNKNOWN",
      duplicateDefinitionState: "UNKNOWN",
      telegramConnectivity: controlledEnum(section.values.Telegram ?? "", {
        connected: "CONNECTED",
        disconnected: "DISCONNECTED",
        unknown: "UNKNOWN",
      }),
      serviceDefinitionState: controlledEnum(section.values["Service Definition"] ?? "", {
        current: "CURRENT",
        "review-required": "REVIEW_REQUIRED",
        outdated: "OUTDATED",
        unknown: "UNKNOWN",
      }),
    };
    const completeness = Object.values(data).includes("UNKNOWN") ? "PARTIAL" : "COMPLETE";
    return parserSuccess(
      "HERMES_GATEWAY_STATUS",
      data,
      completeness,
      1,
      completeness === "PARTIAL" ? ["OPTIONAL_FIELD_MISSING"] : [],
    );
  } catch {
    return parserFailure("HERMES_GATEWAY_STATUS", "INVALID_STRUCTURE");
  }
}
