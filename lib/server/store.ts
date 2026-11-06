// 서버 저장소: Upstash Redis(REST)가 설정되어 있으면 사용하고, 없으면 시연용 메모리 저장소를 쓴다.
// 기관 내부 이관 시에는 이 파일의 어댑터만 내부 Redis·DB로 바꾸면 된다.
import { Redis } from "@upstash/redis";

export interface Store {
  readonly kind: "upstash" | "memory";
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  hget<T>(key: string, field: string): Promise<T | null>;
  hgetall<T>(key: string): Promise<Record<string, T>>;
  hset(key: string, values: Record<string, unknown>): Promise<void>;
  /** 없을 때만 넣는다. 넣었으면 true */
  hsetnx(key: string, field: string, value: unknown): Promise<boolean>;
  hdel(key: string, field: string): Promise<void>;
  /** 목록 끝에 추가하고 최근 max개만 남긴다 */
  rpushCapped(key: string, values: unknown[], max: number): Promise<void>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
}

class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private data = new Map<string, unknown>();
  private clone<T>(v: T): T {
    return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
  }
  async get<T>(key: string) {
    return (this.data.has(key) ? this.clone(this.data.get(key)) : null) as T | null;
  }
  async set(key: string, value: unknown) {
    this.data.set(key, this.clone(value));
  }
  async del(key: string) {
    this.data.delete(key);
  }
  private hash(key: string) {
    let h = this.data.get(key) as Map<string, unknown> | undefined;
    if (!h) {
      h = new Map();
      this.data.set(key, h);
    }
    return h;
  }
  async hget<T>(key: string, field: string) {
    const v = (this.data.get(key) as Map<string, unknown> | undefined)?.get(field);
    return (v === undefined ? null : this.clone(v)) as T | null;
  }
  async hgetall<T>(key: string) {
    const h = this.data.get(key) as Map<string, unknown> | undefined;
    const out: Record<string, T> = {};
    for (const [k, v] of h ?? []) out[k] = this.clone(v) as T;
    return out;
  }
  async hset(key: string, values: Record<string, unknown>) {
    const h = this.hash(key);
    for (const [k, v] of Object.entries(values)) h.set(k, this.clone(v));
  }
  async hsetnx(key: string, field: string, value: unknown) {
    const h = this.hash(key);
    if (h.has(field)) return false;
    h.set(field, this.clone(value));
    return true;
  }
  async hdel(key: string, field: string) {
    (this.data.get(key) as Map<string, unknown> | undefined)?.delete(field);
  }
  async rpushCapped(key: string, values: unknown[], max: number) {
    const list = ((this.data.get(key) as unknown[]) ?? []).concat(values.map((v) => this.clone(v)));
    this.data.set(key, list.slice(-max));
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const list = (this.data.get(key) as T[]) ?? [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return this.clone(list.slice(start < 0 ? Math.max(0, list.length + start) : start, end));
  }
}

class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  constructor(private r: Redis) {}
  async get<T>(key: string) {
    return (await this.r.get<T>(key)) ?? null;
  }
  async set(key: string, value: unknown) {
    await this.r.set(key, value);
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async hget<T>(key: string, field: string) {
    return ((await this.r.hget<T>(key, field)) ?? null) as T | null;
  }
  async hgetall<T>(key: string) {
    return ((await this.r.hgetall<Record<string, T>>(key)) ?? {}) as Record<string, T>;
  }
  async hset(key: string, values: Record<string, unknown>) {
    if (Object.keys(values).length) await this.r.hset(key, values);
  }
  async hsetnx(key: string, field: string, value: unknown) {
    return (await this.r.hsetnx(key, field, value)) === 1;
  }
  async hdel(key: string, field: string) {
    await this.r.hdel(key, field);
  }
  async rpushCapped(key: string, values: unknown[], max: number) {
    if (!values.length) return;
    const p = this.r.pipeline();
    p.rpush(key, ...values);
    p.ltrim(key, -max, -1);
    await p.exec();
  }
  async lrange<T>(key: string, start: number, stop: number) {
    return (await this.r.lrange<T>(key, start, stop)) ?? [];
  }
}

const g = globalThis as unknown as { __kmcStore?: Store };

export function getStore(): Store {
  if (g.__kmcStore) return g.__kmcStore;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  g.__kmcStore = url && token ? new UpstashStore(new Redis({ url, token })) : new MemoryStore();
  return g.__kmcStore;
}

/** 테스트용: 새 메모리 저장소로 바꾼다 */
export function resetStoreForTest(): Store {
  g.__kmcStore = new MemoryStore();
  return g.__kmcStore;
}
