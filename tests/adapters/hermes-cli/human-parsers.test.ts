import { describe, expect, it } from "vitest";

import type { AnyParserResult } from "../../../src/adapters/hermes-cli/parsers/contracts.js";
import { parseCronListText } from "../../../src/adapters/hermes-cli/parsers/cron-parser.js";
import { parseGatewayStatusText } from "../../../src/adapters/hermes-cli/parsers/gateway-parser.js";
import {
  parseCronStatusText,
  parseInsightsText,
  parseMemoryStatusText,
  parseSessionsStatsText,
} from "../../../src/adapters/hermes-cli/parsers/key-value-parsers.js";
import {
  parseGatewayListText,
  parseSkillsText,
  parseToolsText,
} from "../../../src/adapters/hermes-cli/parsers/table-parsers.js";

const fixtures = {
  gatewayList: "Gateways\nNAME | STATE | MODE\ndefault | running | managed\nEnd\n",
  gatewayStatus:
    "Gateway Status\nProcess: running\nProcess Mode: managed\nSystem Service: active\nUser Service: inactive\nTelegram: connected\nService Definition: current\nEnd\n",
  cronStatus: "Cron Status\nScheduler: running\nActive Jobs: 2\nPaused Jobs: 1\nEnd\n",
  cronList:
    "Cron Jobs\nNAME | SCHEDULE_TYPE | SCHEDULE | STATE | RECURRENCE | NEXT_RUN | LAST_RUN | LAST_STATUS | DURATION_MS | MODE | DELIVERY | PROMPT | DESTINATION | SCRIPT_PATH | WORKDIR | ENVIRONMENT | CONTEXT\ndaily-report | cron | 0 5 * * * | active | recurring | 2027-01-02T05:00:00Z | 2027-01-01T05:00:00Z | success | 1200 | agent | telegram:-1001234567890:99 | synthetic private prompt | -1001234567890 | /opt/private/run.py | /home/private/work | PROVIDER_SECRET=*** | synthetic injected context\nEnd\n",
  sessions:
    "Session Stats\nTotal Sessions: 12\nTotal Messages: 80\nActive Profiles: 2\nDatabase Path: /home/private/sessions.db\nLatest Session ID: session-secret\nLatest Title: synthetic private title\nLatest Message: synthetic private message\nEnd\n",
  insights:
    "Insights\nWindow: 1d\nSessions: 10\nMessages: 50\nTool Calls: 20\nInput Tokens: 1000\nOutput Tokens: 500\nReported Total Tokens: 1700\nCached Tokens: 200\nOther Tokens: 25\nModel Category: local-model\nProvider Category: configured-provider\nSource Category: hermes-cli\nEnd\n",
  skills:
    "Enabled Skills\nNAME | CATEGORY | SOURCE | PATH\nresearch-workflows | research | builtin | /home/private/skills/research\nEnd\n",
  tools:
    "Tools\nNAME | CATEGORY | STATUS | CREDENTIAL_REQUIREMENTS | PROVIDER_DETAILS\nweb-search | network | enabled | sk-syn...nary | provider-token=secret\nEnd\n",
  memory:
    "Memory Status\nBuilt-in: enabled\nExternal Provider: disabled\nProvider Category: local\nMemory Records: fake memory record\nMEMORY: fake memory contents\nSOUL: fake soul contents\nUSER: fake user contents\nProvider Credential: sk-syn...nary\nDatabase Path: /home/private/memory.db\nEnd\n",
} as const;

const tableContracts = [
  {
    name: "gateway list",
    parse: parseGatewayListText,
    text: fixtures.gatewayList,
    requiredHeader: "MODE",
  },
  {
    name: "cron list",
    parse: parseCronListText,
    text: fixtures.cronList,
    requiredHeader: "DELIVERY",
  },
  {
    name: "skills",
    parse: parseSkillsText,
    text: fixtures.skills,
    requiredHeader: "NAME",
  },
  {
    name: "tools",
    parse: parseToolsText,
    text: fixtures.tools,
    requiredHeader: "STATUS",
  },
] as const;

function mutateTable(
  text: string,
  mutation: "additional" | "missing" | "duplicate" | "unicode" | "long" | "numeric",
  requiredHeader: string,
): string {
  const lines = text.trimEnd().split("\n");
  const headers = (lines[1] ?? "").split("|").map((value) => value.trim());
  const requiredIndex = headers.indexOf(requiredHeader);
  if (mutation === "additional") {
    lines[1] = `${lines[1]} | EXTRA`;
    for (let index = 2; index < lines.length - 1; index += 1) lines[index] = `${lines[index]} | safe`;
  } else if (mutation === "missing") {
    headers.splice(requiredIndex, 1);
    lines[1] = headers.join(" | ");
    for (let index = 2; index < lines.length - 1; index += 1) {
      const cells = (lines[index] ?? "").split("|").map((value) => value.trim());
      cells.splice(requiredIndex, 1);
      lines[index] = cells.join(" | ");
    }
  } else if (mutation === "duplicate") {
    lines.splice(lines.length - 1, 0, lines[2] ?? "");
  } else {
    const cells = (lines[2] ?? "").split("|").map((value) => value.trim());
    cells[0] = mutation === "unicode" ? "unexpected-☃" : mutation === "long" ? "x".repeat(100) : "1,000";
    lines[2] = cells.join(" | ");
  }
  return `${lines.join("\n")}\n`;
}

const keyValueContracts = [
  {
    name: "gateway status",
    parse: parseGatewayStatusText,
    text: fixtures.gatewayStatus,
    requiredLine: "Process: running",
    empty:
      "Gateway Status\nProcess: absent\nProcess Mode: unknown\nSystem Service: unavailable\nUser Service: unavailable\nTelegram: unknown\nService Definition: unknown\nEnd\n",
  },
  {
    name: "cron status",
    parse: parseCronStatusText,
    text: fixtures.cronStatus,
    requiredLine: "Active Jobs: 2",
    empty: "Cron Status\nScheduler: stopped\nActive Jobs: 0\nPaused Jobs: 0\nEnd\n",
  },
  {
    name: "sessions",
    parse: parseSessionsStatsText,
    text: fixtures.sessions,
    requiredLine: "Total Sessions: 12",
    empty: "Session Stats\nTotal Sessions: 0\nTotal Messages: 0\nEnd\n",
  },
  {
    name: "insights 1d",
    parse: (text: string) => parseInsightsText(text, "1d"),
    text: fixtures.insights,
    requiredLine: "Sessions: 10",
    empty:
      "Insights\nWindow: 1d\nSessions: 0\nMessages: 0\nTool Calls: 0\nInput Tokens: 0\nOutput Tokens: 0\nReported Total Tokens: 0\nEnd\n",
  },
  {
    name: "insights 7d",
    parse: (text: string) => parseInsightsText(text, "7d"),
    text: fixtures.insights.replace("Window: 1d", "Window: 7d"),
    requiredLine: "Sessions: 10",
    empty:
      "Insights\nWindow: 7d\nSessions: 0\nMessages: 0\nTool Calls: 0\nInput Tokens: 0\nOutput Tokens: 0\nReported Total Tokens: 0\nEnd\n",
  },
  {
    name: "insights 30d",
    parse: (text: string) => parseInsightsText(text, "30d"),
    text: fixtures.insights.replace("Window: 1d", "Window: 30d"),
    requiredLine: "Sessions: 10",
    empty:
      "Insights\nWindow: 30d\nSessions: 0\nMessages: 0\nTool Calls: 0\nInput Tokens: 0\nOutput Tokens: 0\nReported Total Tokens: 0\nEnd\n",
  },
  {
    name: "memory",
    parse: parseMemoryStatusText,
    text: fixtures.memory,
    requiredLine: "Built-in: enabled",
    empty:
      "Memory Status\nBuilt-in: disabled\nExternal Provider: disabled\nProvider Category: none\nEnd\n",
  },
] as const;

function replaceKeyValue(line: string, replacement: string): string {
  const separator = line.indexOf(":");
  return `${line.slice(0, separator + 1)} ${replacement}`;
}

const humanParsers: readonly {
  readonly name: string;
  readonly text: string;
  readonly parse: (text: string) => AnyParserResult;
}[] = [
  { name: "gateway list", text: fixtures.gatewayList, parse: parseGatewayListText },
  { name: "gateway status", text: fixtures.gatewayStatus, parse: parseGatewayStatusText },
  { name: "cron status", text: fixtures.cronStatus, parse: parseCronStatusText },
  { name: "cron list", text: fixtures.cronList, parse: parseCronListText },
  { name: "sessions", text: fixtures.sessions, parse: parseSessionsStatsText },
  { name: "insights 1d", text: fixtures.insights, parse: (text) => parseInsightsText(text, "1d") },
  { name: "insights 7d", text: fixtures.insights.replace("Window: 1d", "Window: 7d"), parse: (text) => parseInsightsText(text, "7d") },
  { name: "insights 30d", text: fixtures.insights.replace("Window: 1d", "Window: 30d"), parse: (text) => parseInsightsText(text, "30d") },
  { name: "skills", text: fixtures.skills, parse: parseSkillsText },
  { name: "tools", text: fixtures.tools, parse: parseToolsText },
  { name: "memory", text: fixtures.memory, parse: parseMemoryStatusText },
];

describe("human-readable parser fixture matrix", () => {
  it.each(humanParsers)("parses valid current $name output", ({ parse, text }) => {
    expect(parse(text)).toMatchObject({ ok: true });
  });

  it.each(humanParsers)("accepts harmless blank lines, CRLF, and ANSI in $name", ({ parse, text }) => {
    const withBlankLines = `\n${text.replace(/\n/g, "\n\n")}\n`;
    expect(parse(withBlankLines)).toMatchObject({ ok: true });
    expect(parse(text.replace(/\n/g, "\r\n"))).toMatchObject({ ok: true });
    expect(parse(`\u001b[36m${text.split("\n")[0]}\u001b[0m\n${text.split("\n").slice(1).join("\n")}`)).toMatchObject({ ok: true });
  });

  it.each(humanParsers)("rejects malformed and truncated $name output", ({ parse, text }) => {
    expect(parse(text.replace(text.split("\n")[0] ?? "", "Unexpected Section"))).toMatchObject({
      ok: false,
      errorCode: "PARSER_MISMATCH",
    });
    expect(parse(text.replace(/End\n?$/, "[output truncated]\n"))).toMatchObject({
      ok: false,
      errorCode: "TRUNCATED_OUTPUT",
    });
    expect(parse(text.replace(/End\n?$/, ""))).toMatchObject({
      ok: false,
      errorCode: "TRUNCATED_OUTPUT",
    });
  });

  it.each(tableContracts)("exercises the full table mutation matrix for $name", (contract) => {
    expect(contract.parse(`\n${contract.text.replace(/\n/g, "\r\n\r\n")}`)).toMatchObject({ ok: true });
    expect(contract.parse(mutateTable(contract.text, "additional", contract.requiredHeader))).toMatchObject({
      ok: true,
      warnings: expect.arrayContaining(["ADDITIONAL_COLUMN_IGNORED"]),
    });
    for (const mutation of ["missing", "duplicate", "unicode", "long", "numeric"] as const) {
      expect(contract.parse(mutateTable(contract.text, mutation, contract.requiredHeader))).toMatchObject({
        ok: false,
      });
    }
  });

  it.each(keyValueContracts)("exercises the full key/value mutation matrix for $name", (contract) => {
    expect(contract.parse(contract.empty)).toMatchObject({ ok: true });
    expect(contract.parse(contract.text.replace("End", "Unexpected Field: safe\nEnd"))).toMatchObject({
      ok: false,
      errorCode: "PARSER_MISMATCH",
    });
    expect(contract.parse(contract.text.replace(`${contract.requiredLine}\n`, ""))).toMatchObject({
      ok: false,
      errorCode: "PARSER_MISMATCH",
    });
    expect(
      contract.parse(contract.text.replace(contract.requiredLine, `${contract.requiredLine}\n${contract.requiredLine}`)),
    ).toMatchObject({ ok: false });
    for (const replacement of ["unexpected-☃", "x".repeat(100), "1,000"]) {
      expect(
        contract.parse(
          contract.text.replace(contract.requiredLine, replaceKeyValue(contract.requiredLine, replacement)),
        ),
      ).toMatchObject({ ok: false });
    }
  });

  it("supports authoritative empty list outputs without inventing records", () => {
    expect(parseGatewayListText("Gateways\nNone\nEnd\n")).toMatchObject({ ok: true, completeness: "EMPTY" });
    expect(parseCronListText("Cron Jobs\nNone\nEnd\n")).toMatchObject({ ok: true, completeness: "EMPTY" });
    expect(parseSkillsText("Enabled Skills\nNone\nEnd\n")).toMatchObject({ ok: true, completeness: "EMPTY" });
    expect(parseToolsText("Tools\nNone\nEnd\n")).toMatchObject({ ok: true, completeness: "EMPTY" });
  });

  it("maps explicit zero aggregates to EMPTY without defaulting missing values", () => {
    expect(
      parseSessionsStatsText(
        "Session Stats\nTotal Sessions: 0\nTotal Messages: 0\nEnd\n",
      ),
    ).toMatchObject({ ok: true, completeness: "EMPTY" });
    expect(
      parseInsightsText(
        "Insights\nWindow: 1d\nSessions: 0\nMessages: 0\nTool Calls: 0\nInput Tokens: 0\nOutput Tokens: 0\nReported Total Tokens: 0\nEnd\n",
        "1d",
      ),
    ).toMatchObject({ ok: true, completeness: "EMPTY" });
    expect(parseSessionsStatsText("Session Stats\nTotal Sessions: 0\nEnd\n")).toMatchObject({
      ok: false,
      errorCode: "PARSER_MISMATCH",
    });
  });

  it("rejects contradictory empty session aggregates and retains explicit optional insight metrics", () => {
    expect(
      parseSessionsStatsText(
        "Session Stats\nTotal Sessions: 0\nTotal Messages: 0\nActive Profiles: 1\nEnd\n",
      ),
    ).toMatchObject({ ok: false, errorCode: "INVALID_STRUCTURE" });
    expect(
      parseInsightsText(
        "Insights\nWindow: 1d\nSessions: 0\nMessages: 0\nTool Calls: 0\nInput Tokens: 0\nOutput Tokens: 0\nReported Total Tokens: 0\nCached Tokens: 1\nEnd\n",
        "1d",
      ),
    ).toMatchObject({ ok: true, completeness: "PARTIAL" });
  });

  it("marks missing useful optional fields PARTIAL but ignores absent prohibited columns", () => {
    expect(parseSkillsText("Enabled Skills\nNAME\nresearch-workflows\nEnd\n")).toMatchObject({
      ok: true,
      completeness: "PARTIAL",
      warnings: expect.arrayContaining(["OPTIONAL_FIELD_MISSING"]),
    });
    expect(
      parseCronListText(
        fixtures.cronList
          .replace("2027-01-02T05:00:00Z", "-")
          .replace("2027-01-01T05:00:00Z", "-")
          .replace("| 1200 |", "| - |"),
      ),
    ).toMatchObject({
      ok: true,
      completeness: "PARTIAL",
      warnings: expect.arrayContaining(["OPTIONAL_FIELD_MISSING"]),
    });
    expect(
      parseToolsText("Tools\nNAME | CATEGORY | STATUS\nweb-search | network | enabled\nEnd\n"),
    ).toMatchObject({ ok: true, completeness: "COMPLETE" });
  });

  it("rejects duplicate ignored keys and oversized dropped fields", () => {
    expect(
      parseSessionsStatsText(
        fixtures.sessions.replace(
          "Database Path: /home/private/sessions.db",
          "Database Path: /home/private/sessions.db\nDatabase Path: /other/private.db",
        ),
      ),
    ).toMatchObject({ ok: false, errorCode: "PARSER_MISMATCH" });
    expect(parseCronListText(fixtures.cronList.replace("synthetic private prompt", "x".repeat(4_097)))).toMatchObject({
      ok: false,
      errorCode: "PARSER_MISMATCH",
    });
  });


  it("rejects locale/numeric reinterpretation", () => {
    expect(parseCronStatusText(fixtures.cronStatus.replace("Active Jobs: 2", "Active Jobs: 2,000"))).toMatchObject({ ok: false });
    expect(parseSessionsStatsText(fixtures.sessions.replace("Total Sessions: 12", "Total Sessions: 12.0"))).toMatchObject({ ok: false });
    expect(parseInsightsText(fixtures.insights.replace("Input Tokens: 1000", "Input Tokens: 1.000"), "1d")).toMatchObject({ ok: false });
    expect(parseCronListText(fixtures.cronList.replace("| 1200 |", "| 1,200 |"))).toMatchObject({ ok: false });
  });

  it("keeps incomplete session breakdown PARTIAL without reconciling it to totals", () => {
    const result = parseSessionsStatsText(fixtures.sessions);
    expect(result).toMatchObject({
      ok: true,
      completeness: "PARTIAL",
      normalizedData: {
        totalSessions: 12,
        totalMessages: 80,
        safeAggregates: { activeProfiles: 2 },
      },
    });
  });

  it("rejects unrecognized insight metric definitions", () => {
    expect(
      parseInsightsText(fixtures.insights.replace("End", "Reinterpreted Tokens: 999\nEnd"), "1d"),
    ).toMatchObject({ ok: false, errorCode: "PARSER_MISMATCH" });
  });

  it("does not reinterpret scheduler/job status as delivery evidence", () => {
    const result = parseCronListText(fixtures.cronList);
    expect(result).toMatchObject({
      ok: true,
      normalizedData: {
        jobs: [{ lastStatus: "SUCCESS", deliveryClass: "TELEGRAM" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("delivered");
    expect(JSON.stringify(result)).not.toContain("deliverySucceeded");
  });

  it("does not derive reported token totals from input plus output", () => {
    const result = parseInsightsText(fixtures.insights, "1d");
    expect(result).toMatchObject({
      ok: true,
      normalizedData: { inputTokens: 1000, outputTokens: 500, reportedTotalTokens: 1700 },
    });
  });

  it("drops all privacy canaries through explicit projection", () => {
    const results = [
      parseCronListText(fixtures.cronList),
      parseSessionsStatsText(fixtures.sessions),
      parseSkillsText(fixtures.skills),
      parseToolsText(fixtures.tools),
      parseMemoryStatusText(fixtures.memory),
    ];
    const serialized = JSON.stringify(results);
    for (const canary of [
      "synthetic private prompt",
      "-1001234567890",
      "/opt/private/run.py",
      "/home/private/work",
      "PROVIDER_SECRET",
      "synthetic injected context",
      "/home/private/sessions.db",
      "synthetic private title",
      "synthetic private message",
      "/home/private/skills/research",
      "sk-syn...nary",
      "provider-token=secret",
      "fake memory record",
      "fake soul contents",
      "fake user contents",
      "/home/private/memory.db",
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });
});

describe("gateway multidimensional scenarios", () => {
  const gateway = (
    process: string,
    mode: string,
    system: string,
    user: string,
    telegram: string,
    definition: string,
    extras = "",
  ) =>
    `Gateway Status\nProcess: ${process}\nProcess Mode: ${mode}\nSystem Service: ${system}\nUser Service: ${user}\nTelegram: ${telegram}\nService Definition: ${definition}\n${extras}End\n`;

  it.each([
    ["running system/user disagreement", gateway("running", "managed", "active", "inactive", "connected", "current"), { processState: "RUNNING", systemServiceState: "ACTIVE", userServiceState: "INACTIVE" }],
    ["manual process", gateway("running", "manual", "inactive", "inactive", "connected", "current"), { processMode: "MANUAL" }],
    ["both services active", gateway("running", "managed", "active", "active", "connected", "current"), { systemServiceState: "ACTIVE", userServiceState: "ACTIVE" }],
    ["process/service disagreement", gateway("stopped", "managed", "active", "inactive", "disconnected", "current"), { processState: "STOPPED", systemServiceState: "ACTIVE" }],
    ["Telegram connected with warning", gateway("running", "managed", "active", "inactive", "connected", "review-required"), { telegramConnectivity: "CONNECTED", serviceDefinitionState: "REVIEW_REQUIRED" }],
    ["process absent service active", gateway("absent", "unknown", "active", "inactive", "unknown", "current"), { processState: "STOPPED", systemServiceState: "ACTIVE" }],
    ["service visibility unavailable", gateway("running", "manual", "unavailable", "unavailable", "connected", "unknown"), { systemServiceState: "UNAVAILABLE", userServiceState: "UNAVAILABLE" }],
    ["outdated definition strips command", gateway("running", "managed", "active", "inactive", "connected", "outdated", "Warning: definition stale\nSuggested Command: systemctl restart hermes\nPID: 12345\n"), { serviceDefinitionState: "OUTDATED" }],
  ])("preserves $0 dimensions", (_label, text, expected) => {
    const result = parseGatewayStatusText(text);
    expect(result).toMatchObject({ ok: true, normalizedData: expected });
    expect(JSON.stringify(result)).not.toContain("systemctl");
    expect(JSON.stringify(result)).not.toContain("12345");
    expect(JSON.stringify(result)).not.toHaveProperty("gatewayHealthy");
  });
});
