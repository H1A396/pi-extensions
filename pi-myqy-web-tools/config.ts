// pi-myqy-web-tools 配置读取
// ---------------------------------------------------------------
// 配置路径：~/.pi/agent/pi-myqy-web-tools.json
// 缺失/无效 → 返回内置默认配置（fail-open，仅保留免费兜底供应商）

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProviderConfig, WebToolsConfig } from "./types.ts";

export const CONFIG_PATH = join(homedir(), ".pi/agent/pi-myqy-web-tools.json");

const DEFAULT_CONFIG: WebToolsConfig = {
  quota: {
    refreshTtlSeconds: 300,
    lowThresholdPercent: 20,
    exhaustedThresholdPercent: 0,
    exaInitialFreeUsd: 20,
    exaMonthlyTopUpUsd: 10,
  },
  searchProviders: [
    { id: "duckduckgo", name: "DuckDuckGo", enabled: true, order: 90, supports: ["search"], free: true },
  ],
  search: {},
  extract: {
    strategy: "provider-first",
    providers: [],
    fallbacks: ["r.jina.ai"],
  },
};

function sanitizeProvider(raw: any): ProviderConfig | null {
  if (raw === null || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;
  const supports: ("search" | "extract")[] = [];
  if (Array.isArray(raw.supports)) {
    for (const s of raw.supports) {
      if (s === "search" || s === "extract") supports.push(s);
    }
  }
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : id,
    enabled: raw.enabled !== false,
    apiKey: typeof raw.apiKey === "string" && raw.apiKey ? raw.apiKey : undefined,
    order: typeof raw.order === "number" ? raw.order : 100,
    supports,
    free: raw.free === true,
    url: typeof raw.url === "string" ? raw.url : undefined,
  };
}

export async function readConfig(): Promise<WebToolsConfig> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    if (raw === null || typeof raw !== "object") return DEFAULT_CONFIG;

    const providers: ProviderConfig[] = [];
    if (Array.isArray(raw.searchProviders)) {
      for (const p of raw.searchProviders) {
        const sp = sanitizeProvider(p);
        if (sp && (sp.enabled || sp.apiKey || sp.free)) providers.push(sp);
      }
    }

    const quota = {
      refreshTtlSeconds:
        typeof raw.quota?.refreshTtlSeconds === "number" ? raw.quota.refreshTtlSeconds : 300,
      lowThresholdPercent:
        typeof raw.quota?.lowThresholdPercent === "number"
          ? raw.quota.lowThresholdPercent
          : 20,
      exhaustedThresholdPercent:
        typeof raw.quota?.exhaustedThresholdPercent === "number"
          ? raw.quota.exhaustedThresholdPercent
          : 0,
      exaInitialFreeUsd:
        typeof raw.quota?.exaInitialFreeUsd === "number" ? raw.quota.exaInitialFreeUsd : 20,
      exaMonthlyTopUpUsd:
        typeof raw.quota?.exaMonthlyTopUpUsd === "number" ? raw.quota.exaMonthlyTopUpUsd : 10,
      exaAccountCreatedAt:
        typeof raw.quota?.exaAccountCreatedAt === "string"
          ? raw.quota.exaAccountCreatedAt
          : undefined,
    };

    const search = {
      order: Array.isArray(raw.search?.order)
        ? raw.search.order.map(String).filter((x: string) => x)
        : undefined,
    };

    const extract = {
      strategy: "provider-first" as const,
      order: Array.isArray(raw.extract?.order)
        ? raw.extract.order.map(String).filter((x: string) => x)
        : undefined,
      providers: Array.isArray(raw.extract?.providers)
        ? raw.extract.providers.map(String)
        : [],
      fallbacks: Array.isArray(raw.extract?.fallbacks)
        ? raw.extract.fallbacks.map(String)
        : ["r.jina.ai"],
    };

    // 若未显式配置任何供应商 → 回退到默认免费兜底
    if (providers.length === 0) return { ...DEFAULT_CONFIG, quota, search, extract };
    return { version: raw.version, quota, searchProviders: providers, search, extract };
  } catch {
    return DEFAULT_CONFIG;
  }
}
