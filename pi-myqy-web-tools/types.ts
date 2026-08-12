// pi-myqy-web-tools 统一类型定义
// ---------------------------------------------------------------

/** 供应商配置（来自 ~/.pi/agent/pi-myqy-web-tools.json） */
export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  apiKey?: string;
  /** 搜索/提取优先级，越小越优先 */
  order: number;
  supports: ("search" | "extract")[];
  /** 免费无限供应商（如 DuckDuckGo / SearXNG），不参与额度管理 */
  free?: boolean;
  /** 自建服务地址（如 SearXNG 实例 URL） */
  url?: string;
}

/** 扩展总配置 */
export interface WebToolsConfig {
  version?: number;
  quota: {
    /** 额度查询结果缓存时长（秒） */
    refreshTtlSeconds: number;
    /**
     * 低配额预警阈值（占免费额度的百分比，1-100）。
     * 剩余免费额度 ≤ 免费总额度 × percent% 时标记为低配额。
     */
    lowThresholdPercent: number;
    /**
     * 耗尽阈值（占免费额度的百分比）。
     * 剩余免费额度 ≤ 免费总额度 × percent% 时视为耗尽。
     */
    exhaustedThresholdPercent: number;
    /** Exa 免费额度模型：初始免费额度（美元） */
    exaInitialFreeUsd: number;
    /** Exa 免费额度模型：Free Tier 每月补充额度（美元） */
    exaMonthlyTopUpUsd: number;
    /** Exa 账号创建时间（ISO）。缺省用首次使用时间。 */
    exaAccountCreatedAt?: string;
  };
  searchProviders: ProviderConfig[];
  /**
   * 搜索策略：显式供应商顺序（从左到右）。
   * 配置后仅使用列出的供应商，严格按数组顺序尝试；
   * 未配置则回退为按 provider.order 字段升序。
   */
  search: {
    order?: string[];
  };
  extract: {
    strategy: "provider-first";
    /**
     * 提取策略：显式供应商顺序（从左到右）。
     * 配置后仅使用列出的供应商，严格按数组顺序尝试；
     * 未配置则回退为 providers + fallbacks。
     */
    order?: string[];
    /** 提取优先使用的供应商 id（按顺序） */
    providers: string[];
    /** 提取兜底方案 id 列表（如 "r.jina.ai"） */
    fallbacks: string[];
  };
}

/** 搜索请求 */
export interface SearchOptions {
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
}

/** 单条搜索结果 */
export interface SearchItem {
  title: string;
  url: string;
  snippet: string;
}

/** 搜索响应（统一格式） */
export interface SearchResponse {
  provider: string;
  results: SearchItem[];
  /** 本次调用消耗（美元），Exa 等按量计费用 */
  costUsd?: number;
}

/** 提取请求 */
export interface ExtractOptions {
  url: string;
  signal?: AbortSignal;
}

/** 提取响应（统一格式，Markdown 内容） */
export interface ExtractResponse {
  provider: string;
  title?: string;
  content: string;
  /** 本次调用消耗（美元），余额型供应商（如 Exa）返回 */
  costUsd?: number;
}

/** 额度信息（统一格式） */
export interface QuotaInfo {
  provider: string;
  /** 总限额；undefined = 无限 */
  total?: number;
  used: number;
  remaining?: number;
  /** 单位："credits" | "usd" | "requests" | "unlimited" */
  unit: string;
  updatedAt: number;
  /** 是否已标记耗尽 */
  exhausted?: boolean;
}

/** 供应商统一接口 */
export interface SearchProvider {
  readonly id: string;
  search(options: SearchOptions): Promise<SearchResponse>;
  extract?(options: ExtractOptions): Promise<ExtractResponse>;
  /** 可选：查询实时额度（无则用本地累计） */
  getQuota?(): Promise<QuotaInfo>;
}

/** 额度状态（持久化到 ~/.pi/agent/pi-myqy-web-tools-state.json） */
export interface ProviderQuotaState {
  /** 本地估算剩余额度（Exa 用美元余额；其他为积分） */
  remaining?: number;
  /** 本地累计消耗 */
  spent?: number;
  /** 上次从服务端同步的额度快照 */
  serverQuota?: QuotaInfo;
  /** 最近一次额度刷新时间戳 */
  lastCheck?: number;
  /** 是否已标记耗尽（避免反复尝试） */
  exhausted?: boolean;
  /** 耗尽快照时间戳 */
  exhaustedAt?: number;
  /** 余额型供应商（Exa）计费基准时间戳（账号创建/首次使用） */
  baselineAt?: number;
  /** 最近一次手动校准时间戳（/web-quota --set） */
  calibratedAt?: number;
}

export interface QuotaStateFile {
  providers: Record<string, ProviderQuotaState>;
  updatedAt: number;
}
