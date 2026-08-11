// 通用供应商模型过滤扩展
// ---------------------------------------------------------------
// 通过配置文件对任意 pi 内置供应商的模型列表进行过滤（隐藏付费/不需要的模型）。
//
// 配置文件 ~/.pi/agent/pi-myqy-model-filters.json：
// {
//   "hotReload": true,                     // 自动热更新开关（默认 true）
//   "providers": {
//     "opencode":   { "only": ["*-free"] },   // 只保留 id 匹配 *-free 的模型
//     "opencode-go": { "except": ["gpt-5*"] } // 剔除 id 匹配的模型（示例）
//   }
// }
//
// - only ：白名单，仅保留匹配的模型（glob * ? 或精确 id）
// - except：黑名单，剔除匹配的模型
// - only 与 except 可同时使用：先 only 过滤，再 except 剔除
// - 未在 providers 中列出的供应商 → 完全不处理（保持 pi 默认）
// - 配置缺失/无效 → fail-open：不处理任何供应商
//
// 原理：pi.registerProvider(provider, { models }) 会用扩展 models 完全替换
// 该供应商的模型列表，从而在 /model、--list-models、Ctrl+P、认证解析等
// 所有下游链路中生效。模型元数据（api/baseUrl 等）缺失时自动从原模型继承。
//
// 热更新：监听 pi 写入 models-store.json（远程目录每 4h 自动刷新 /
// pi update --models 会重写该文件），防抖 + 变化检测后重新注册；
// 编辑 pi-myqy-model-filters.json 也会实时重新应用规则（含热更新开关切换）。

import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STORE_PATH = join(homedir(), ".pi/agent/models-store.json");
const CONFIG_PATH = join(homedir(), ".pi/agent/pi-myqy-model-filters.json");

interface ProviderRule {
  only?: string[];
  except?: string[];
}

interface FilterConfig {
  hotReload: boolean;
  providers: Record<string, ProviderRule>;
}

/** 读取配置：缺失/无效 → 空配置（fail-open，不处理任何供应商），hotReload 默认 true */
async function readConfig(): Promise<FilterConfig> {
  try {
    const raw: any = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    if (raw === null || typeof raw !== "object") return { hotReload: true, providers: {} };
    const providers: Record<string, ProviderRule> = {};
    if (raw.providers && typeof raw.providers === "object") {
      for (const [id, rule] of Object.entries<any>(raw.providers)) {
        if (rule !== null && typeof rule === "object") {
          providers[id] = {
            only: Array.isArray(rule.only) ? rule.only.map(String) : undefined,
            except: Array.isArray(rule.except) ? rule.except.map(String) : undefined,
          };
        }
      }
    }
    return { hotReload: raw.hotReload !== false, providers };
  } catch {
    return { hotReload: true, providers: {} };
  }
}

/** 简单 glob（* ?）转为正则 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

function matches(modelId: string, patterns: string[]): boolean {
  return patterns.some((p) => p === modelId || globToRegExp(p).test(modelId));
}

/** 应用过滤规则；无有效规则时返回 undefined（表示不处理该供应商） */
function applyFilters(models: any[], rule?: ProviderRule): any[] | undefined {
  if (!rule) return undefined;
  const { only, except } = rule;
  if ((!only || only.length === 0) && (!except || except.length === 0)) return undefined;
  return models.filter(
    (m) =>
      (!only || only.length === 0 || matches(m.id, only)) &&
      (!except || except.length === 0 || !matches(m.id, except))
  );
}

/** 从 pi 的远程目录缓存中读取某供应商的完整模型列表 */
async function loadModels(providerId: string): Promise<any[] | undefined> {
  try {
    const store = JSON.parse(await readFile(STORE_PATH, "utf8"));
    const models = store?.[providerId]?.models;
    return Array.isArray(models) && models.length > 0 ? models : undefined;
  } catch {
    return undefined; // 文件缺失或写入中 → 跳过本次，保留现有列表
  }
}

export default async function (pi: ExtensionAPI) {
  let debounce: NodeJS.Timeout | undefined;
  let storeWatcher: ReturnType<typeof watch> | undefined;
  let configWatcher: ReturnType<typeof watch> | undefined;
  const lastKeys = new Map<string, string>();

  /** 对配置中所有供应商应用过滤并注册；无变化时零副作用 */
  const apply = async () => {
    const config = await readConfig();
    for (const [providerId, rule] of Object.entries(config.providers)) {
      const all = await loadModels(providerId);
      if (!all?.length) continue;              // 缓存无该供应商 → 跳过，热更新后自动补上
      const filtered = applyFilters(all, rule);
      if (!filtered) continue;                 // 无有效规则 → 不处理
      const key = filtered.map((m) => m.id).sort().join(",");
      if (lastKeys.get(providerId) === key) continue;
      lastKeys.set(providerId, key);
      pi.registerProvider(providerId, { models: filtered });
    }
  };

  const startWatcher = () => {
    if (storeWatcher) return;
    storeWatcher = watch(STORE_PATH, { persistent: false }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = undefined;
        apply().catch(() => {});
      }, 300);
    });
    storeWatcher.on("error", () => {});
  };

  const stopWatcher = () => {
    if (debounce) {
      clearTimeout(debounce);
      debounce = undefined;
    }
    storeWatcher?.close();
    storeWatcher = undefined;
  };

  await apply();                                       // 核心：启动时应用全部规则
  if ((await readConfig()).hotReload) startWatcher();
  else stopWatcher();

  pi.on("session_start", () => {
    // 编辑 pi-myqy-model-filters.json → 实时重应用规则 + 切换热更新开关
    try {
      configWatcher = watch(CONFIG_PATH, { persistent: false }, () => {
        setTimeout(async () => {
          const on = (await readConfig()).hotReload;
          on ? startWatcher() : stopWatcher();
          await apply().catch(() => {});
        }, 200);
      });
      configWatcher.on("error", () => {});
    } catch {}
  });

  pi.on("session_shutdown", () => {
    stopWatcher();
    configWatcher?.close();
    configWatcher = undefined;
  });
}