/**
 * Multi-Provider LLM Manager
 * Handles round-robin load balancing, rate limit tracking, and automatic failover
 * between Groq and Gemini APIs
 */

import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

class LLMProviderManager {
  constructor(config = {}) {
    this.providers = [];
    this.providerHealth = new Map();
    this.defaultTimeout = config.timeout || 45000;
    this.maxRetryWait = config.maxRetryWait || 15000;
    this.maxRetries = config.maxRetries || 3;

    // Initialize providers from config
    if (config.groqKeys) {
      config.groqKeys.forEach((key, index) => {
        if (key && key !== "YOUR_KEY_HERE") {
          const id = `groq_${index + 1}`;
          this.providers.push({
            id,
            type: "groq",
            apiKey: key,
            model: config.groqModel || "llama-3.3-70b-versatile",
            callCount: 0,
          });
          this.providerHealth.set(id, {
            status: "healthy",
            lastError: null,
            rateLimitUntil: null,
          });
        }
      });
    }

    if (config.geminiKey && config.geminiKey !== "YOUR_KEY_HERE") {
      const id = "gemini_1";
      this.providers.push({
        id,
        type: "gemini",
        apiKey: config.geminiKey,
        model: config.geminiModel || "gemini-2.5-flash",
        callCount: 0,
      });
      this.providerHealth.set(id, {
        status: "healthy",
        lastError: null,
        rateLimitUntil: null,
      });
    }

    if (this.providers.length === 0) {
      throw new Error("No valid LLM providers configured");
    }

    console.log(`✅ LLM Manager initialized with ${this.providers.length} provider(s):`);
    this.providers.forEach((p) => console.log(`   - ${p.id} (${p.type})`));
  }

  getHealthyProviders() {
    const now = Date.now();
    return this.providers.filter((provider) => {
      const health = this.providerHealth.get(provider.id);
      if (health.status === "rate_limited" && health.rateLimitUntil) {
        if (now < health.rateLimitUntil) {
          return false; // Still rate limited
        }
        // Rate limit expired, mark as healthy
        health.status = "healthy";
        health.rateLimitUntil = null;
      }
      return health.status === "healthy";
    });
  }

  getNextProvider() {
    const healthy = this.getHealthyProviders();
    if (healthy.length === 0) {
      return null;
    }
    // Round-robin: return provider with lowest call count
    return healthy.sort((a, b) => a.callCount - b.callCount)[0];
  }

  markProviderRateLimited(providerId, retryAfterSeconds) {
    const health = this.providerHealth.get(providerId);
    if (!health) return;

    health.status = "rate_limited";
    health.rateLimitUntil = Date.now() + (retryAfterSeconds || 60) * 1000;
    health.lastError = `Rate limited for ${retryAfterSeconds || 60}s`;
    console.warn(`⚠️  Provider ${providerId} rate limited until ${new Date(health.rateLimitUntil).toISOString()}`);
  }

  markProviderHealthy(providerId) {
    const health = this.providerHealth.get(providerId);
    if (!health) return;

    if (health.status !== "healthy") {
      console.log(`✅ Provider ${providerId} recovered`);
    }
    health.status = "healthy";
    health.lastError = null;
    health.rateLimitUntil = null;
  }

  async callGroq(provider, messages, options = {}) {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 800,
        messages,
      }),
      signal: AbortSignal.timeout(options.timeout || this.defaultTimeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw {
          code: 429,
          retryAfter: retryAfter ? parseInt(retryAfter, 10) : 60,
          message: `Groq rate limit: ${errorText}`,
        };
      }
      throw new Error(`Groq error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  async callGemini(provider, messages, options = {}) {
    // Convert OpenAI-style messages to Gemini format
    const geminiContents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = msg.content;
      } else {
        geminiContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const body = {
      contents: geminiContents,
      generationConfig: {
        temperature: options.temperature ?? 0.1,
        maxOutputTokens: options.maxTokens ?? 800,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const url = `${GEMINI_API_URL}/${provider.model}:generateContent?key=${provider.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout || this.defaultTimeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429) {
        throw {
          code: 429,
          retryAfter: 60,
          message: `Gemini rate limit: ${errorText}`,
        };
      }
      throw new Error(`Gemini error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async chat(messages, options = {}) {
    const healthyProviders = this.getHealthyProviders();

    if (healthyProviders.length === 0) {
      const healthStatus = Array.from(this.providerHealth.entries())
        .map(([id, h]) => `${id}: ${h.status}`)
        .join(", ");
      throw new Error(`All LLM providers exhausted or rate-limited. Status: ${healthStatus}`);
    }

    let lastError = null;

    for (const provider of healthyProviders) {
      try {
        provider.callCount++;
        const startTime = Date.now();

        let content;
        if (provider.type === "groq") {
          content = await this.callGroq(provider, messages, options);
        } else if (provider.type === "gemini") {
          content = await this.callGemini(provider, messages, options);
        } else {
          throw new Error(`Unknown provider type: ${provider.type}`);
        }

        const duration = Date.now() - startTime;
        this.markProviderHealthy(provider.id);

        return {
          content,
          provider: provider.id,
          duration,
        };
      } catch (err) {
        lastError = err;

        if (err.code === 429) {
          this.markProviderRateLimited(provider.id, err.retryAfter);
          console.warn(`  ⏭️  Skipping to next provider due to rate limit on ${provider.id}`);
          continue; // Try next provider
        }

        // Other errors (timeout, network, etc) - try next provider
        console.warn(`  ⚠️  Provider ${provider.id} failed: ${err.message}`);
        continue;
      }
    }

    throw new Error(`All providers failed. Last error: ${lastError?.message || "unknown"}`);
  }

  getStats() {
    return {
      providers: this.providers.map((p) => ({
        id: p.id,
        type: p.type,
        callCount: p.callCount,
        health: this.providerHealth.get(p.id),
      })),
      totalCalls: this.providers.reduce((sum, p) => sum + p.callCount, 0),
    };
  }
}

export { LLMProviderManager };
