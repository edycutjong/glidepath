import { createHash } from "node:crypto";

/** Every Nansen call the engine makes, recorded for the provenance drawer and `--explain`. */
export type Call = {
  endpoint: string;
  method: "POST" | "GET";
  body: Record<string, unknown>;
  /** credits Nansen actually deducted (`X-Nansen-Credits-Used` header); falls back to the static table when absent */
  credits: number;
  /** account balance after the call (`X-Nansen-Credits-Remaining`), when the header was present */
  creditsRemaining?: number;
  ms: number;
  cached: boolean;
  status: number;
  fieldsUsed: string[];
  /** sha256 of the raw response body — verify.ts compares live vs fixture */
  responseHash: string;
  /** network attempts made (1 = clean; 2 = one timeout/429/5xx was retried) */
  attempts: number;
  /** wall time including any failed attempt */
  totalMs: number;
  /** false when every attempt failed; `error` says why. Failed calls are recorded at 0 credits. */
  ok: boolean;
  error?: string;
};

export type CallOptions = { timeoutMs?: number; retries?: number };

/**
 * Live call events for the web app's Nansen call rail: `start` fires before the first network attempt (the rail shows a
 * pending row), `end` fires once the Call is recorded — the SAME object that lands in `calls` and in the provenance
 * drawer, so the rail and the drawer can never disagree. Cache hits fire `end` only (nothing was pending).
 */
export type CallEvent = { type: "start"; id: number; method: "POST" | "GET"; endpoint: string; body: Record<string, unknown> } | { type: "end"; id: number; call: Call };
export type CallObserver = (event: CallEvent) => void;

export type ClientOptions = {
  baseUrl?: string;
  /** requests per second, client-side burst cap (Nansen Free: 15/s, 300/min) */
  rps?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** receives every call as it starts and as it lands (see CallEvent) */
  onCall?: CallObserver;
};

/** Static fallback cost per endpoint (docs.nansen.ai credits table, 2026-09-16). Live calls use the response header instead. */
export const CREDITS: Record<string, number> = {
  "search/general": 0,
  "tgm/token-information": 1,
  "tgm/who-bought-sold": 1,
  "tgm/flow-intelligence": 1,
  "tgm/flows": 1,
  "tgm/indicators": 5,
  "trade/quote": 1,
};

export class NansenError extends Error {
  constructor(
    public endpoint: string,
    public status: number,
    public bodyText: string,
  ) {
    super(`Nansen ${endpoint} → HTTP ${status}: ${NansenError.redact(NansenError.reason(bodyText))}`);
    this.bodyText = NansenError.redact(bodyText);
  }
  /** An upstream body that echoes the key back must not reach `plan.errors` — that JSON is returned to the browser. */
  static redact(text: string): string {
    return text.replace(/nsn_[A-Za-z0-9_-]{8,}/g, "nsn_[redacted]");
  }
  /** Nansen error bodies are JSON `{error, message}`; show the message, not the envelope, so a 422 reads as a sentence on screen. */
  static reason(bodyText: string): string {
    try {
      const j = JSON.parse(bodyText) as { message?: unknown; error?: unknown; detail?: unknown };
      const m = [j.message, j.detail, j.error].find((v) => typeof v === "string" && v.trim());
      if (typeof m === "string") return m.trim().slice(0, 240);
    } catch {
      /* not JSON */
    }
    return bodyText.slice(0, 200);
  }
}

function withAttempts(e: unknown, attempts: number): unknown {
  if (e && typeof e === "object") (e as { attempts?: number }).attempts = attempts;
  return e;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Minimal token bucket: at most `rps` requests per rolling second. */
class RateLimiter {
  private timestamps: number[] = [];
  constructor(private rps: number) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 1000);
      if (this.timestamps.length < this.rps) {
        this.timestamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 - (now - this.timestamps[0]) + 5));
    }
  }
}

export type RawResult = { text: string; ms: number; status: number; attempts: number; totalMs: number; creditsUsed?: number; creditsRemaining?: number };

function headerNum(res: Response, name: string): number | undefined {
  const v = res.headers.get(name);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class NansenClient {
  private baseUrl: string;
  private limiter: RateLimiter;
  protected timeoutMs: number;
  private fetchImpl: typeof fetch;
  /** Every call made through this client, in order. */
  readonly calls: Call[] = [];
  /** live observer (the call rail); set in the constructor or with `observe()` */
  onCall?: CallObserver;
  private seq = 0;

  constructor(
    private apiKey: string,
    opts: ClientOptions = {},
  ) {
    if (!apiKey || !apiKey.startsWith("nsn_")) {
      throw new Error("NANSEN_API_KEY missing or malformed (expected nsn_…)");
    }
    this.baseUrl = opts.baseUrl ?? "https://api.nansen.ai/api/v1";
    this.limiter = new RateLimiter(opts.rps ?? 8);
    this.timeoutMs = opts.timeoutMs ?? 8000; // Nansen occasionally hangs on very large tokens; 8 s + one retry caps a call at ~17 s
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onCall = opts.onCall;
  }

  /** Attach (or detach, with undefined) the live observer. */
  observe(fn: CallObserver | undefined): void {
    this.onCall = fn;
  }

  /** Announce a call that is about to hit the network; returns its id for `push`. */
  protected begin(method: "POST" | "GET", endpoint: string, body: Record<string, unknown>): number {
    const id = ++this.seq;
    this.emit({ type: "start", id, method, endpoint, body });
    return id;
  }

  /** The one place a Call enters `calls` — and the observer sees the identical object. */
  protected push(call: Call, id = ++this.seq): void {
    this.calls.push(call);
    this.emit({ type: "end", id, call });
  }

  private emit(event: CallEvent): void {
    try {
      this.onCall?.(event);
    } catch {
      /* an observer must never break a plan */
    }
  }

  /** POST `endpoint` with a JSON body; one retry on 429/5xx/timeout unless `retries: 0`; records the call. */
  async post<T = unknown>(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[] = [], opts: CallOptions = {}): Promise<T> {
    return this.request<T>("POST", endpoint, body, fieldsUsed, opts);
  }

  /** GET `endpoint?query` (trade/quote); same retry, timeout and provenance rules as `post`. */
  async get<T = unknown>(endpoint: string, query: Record<string, unknown>, fieldsUsed: string[] = [], opts: CallOptions = {}): Promise<T> {
    return this.request<T>("GET", endpoint, query, fieldsUsed, opts);
  }

  protected async request<T>(method: "POST" | "GET", endpoint: string, body: Record<string, unknown>, fieldsUsed: string[], opts: CallOptions): Promise<T> {
    const t0 = Date.now();
    const id = this.begin(method, endpoint, body);
    try {
      const raw = await this.raw(method, endpoint, body, opts);
      this.record(method, endpoint, body, fieldsUsed, raw, id);
      return JSON.parse(raw.text) as T;
    } catch (e) {
      this.recordFailure(method, endpoint, body, fieldsUsed, e, Date.now() - t0, id);
      throw e;
    }
  }

  protected record(method: "POST" | "GET", endpoint: string, body: Record<string, unknown>, fieldsUsed: string[], raw: RawResult, id?: number) {
    this.push(
      {
        endpoint,
        method,
        body,
        fieldsUsed,
        cached: false,
        ok: true,
        credits: raw.creditsUsed ?? CREDITS[endpoint] ?? 1,
        creditsRemaining: raw.creditsRemaining,
        ms: raw.ms,
        status: raw.status,
        responseHash: sha256(raw.text),
        attempts: raw.attempts,
        totalMs: raw.totalMs,
      },
      id,
    );
  }

  /** A call that failed every attempt still appears in provenance — a hidden timeout is a recording risk, not a detail. */
  protected recordFailure(method: "POST" | "GET", endpoint: string, body: Record<string, unknown>, fieldsUsed: string[], e: unknown, totalMs: number, id?: number) {
    const status = e instanceof NansenError ? e.status : 0;
    const error = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message.slice(0, 160)) : String(e);
    const attempts = (e as { attempts?: number })?.attempts ?? 1;
    this.push({ endpoint, method, body, credits: 0, ms: 0, cached: false, status, fieldsUsed, responseHash: "", attempts, totalMs, ok: false, error }, id);
  }

  /** The network call itself, returning the raw body so callers (and the cache) hash exactly what Nansen sent. */
  protected async raw(method: "POST" | "GET", endpoint: string, body: Record<string, unknown>, opts: CallOptions = {}): Promise<RawResult> {
    let url = `${this.baseUrl}/${endpoint}`;
    if (method === "GET") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) qs.set(k, String(v));
      url += `?${qs.toString()}`;
    }
    const t0 = Date.now();
    const maxAttempts = 1 + (opts.retries ?? 1);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let lastErr: unknown;
    let attemptsMade = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attemptsMade = attempt + 1;
      await this.limiter.take();
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
          body: method === "POST" ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        const text = await res.text();
        const ms = Date.now() - started;
        if (res.status === 429 || res.status >= 500) {
          lastErr = new NansenError(endpoint, res.status, text);
          if (attempt < maxAttempts - 1) {
            const retryAfter = Number(res.headers.get("retry-after") ?? "") || 0;
            await new Promise((r) => setTimeout(r, Math.min(Math.max(750, retryAfter * 1000), 5000)));
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) throw new NansenError(endpoint, res.status, text);
        return {
          text,
          ms,
          status: res.status,
          attempts: attempt + 1,
          totalMs: Date.now() - t0,
          creditsUsed: headerNum(res, "x-nansen-credits-used"),
          creditsRemaining: headerNum(res, "x-nansen-credits-remaining"),
        };
      } catch (e) {
        lastErr = e;
        if (attempt === maxAttempts - 1 || !(e instanceof Error && e.name === "AbortError")) throw withAttempts(e, attemptsMade);
      } finally {
        clearTimeout(timer);
      }
    }
    throw withAttempts(lastErr, attemptsMade);
  }

  /** Credits spent through this client so far (header-reported; cached and failed calls count 0). */
  get creditsSpent(): number {
    return this.calls.reduce((n, c) => n + c.credits, 0);
  }

  /** Last balance Nansen reported, if any live call was made. */
  get creditsRemaining(): number | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) if (this.calls[i].creditsRemaining !== undefined) return this.calls[i].creditsRemaining;
    return undefined;
  }
}

/** Load the key from the environment; `set -a; source ~/.config/nansen/meridian.env; set +a` first. */
export function clientFromEnv(opts?: ClientOptions): NansenClient {
  return new NansenClient(process.env.NANSEN_API_KEY ?? "", opts);
}
