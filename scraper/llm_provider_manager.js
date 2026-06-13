/**
 * Gemini LLM Provider
 * Handles Gemini API calls with rate limit tracking
 */

import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

class LLMProviderManager {
  constructor(config = {}) {
    this.defaultTimeout = config.timeout || 45000;
    this.maxRetries = config.maxRetries || 3;

    if (!config.geminiKey || config.geminiKey === "YOUR_KEY_HERE") {
      throw new Error("Gemini API key is required");
    }

    this.provider = {
      id: "gemini_1",
      type: "gemini",
      apiKey: config.geminiKey,
      model: config.geminiModel || "gemini-2.5-flash",
      callCount: 0,
    };

    this.health = {
      status: "healthy",
      lastError: null,
      rateLimitUntil: null,
    };

    console.log(`✅ Gemini LLM initialized: ${this.provider.model}`);
  }

  isHealthy() {
    const now = Date.now();
    if (this.health.status === "rate_limited" && this.health.rateLimitUntil) {
      if (now < this.health.rateLimitUntil) {
        return false;
      }
      this.health.status = "healthy";
      this.health.rateLimitUntil = null;
    }
    return this.health.status === "healthy";
  }

  markRateLimited(retryAfterSeconds) {
    this.health.status = "rate_limited";
    this.health.rateLimitUntil = Date.now() + (retryAfterSeconds || 60) * 1000;
    this.health.lastError = `Rate limited for ${retryAfterSeconds || 60}s`;
    console.warn(`⚠️  Gemini rate limited until ${new Date(this.health.rateLimitUntil).toISOString()}`);
  }

  markHealthy() {
    if (this.health.status !== "healthy") {
      console.log(`✅ Gemini recovered`);
    }
    this.health.status = "healthy";
    this.health.lastError = null;
    this.health.rateLimitUntil = null;
  }

  async callGemini(messages, options = {}) {
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

    const url = `${GEMINI_API_URL}/${this.provider.model}:generateContent?key=${this.provider.apiKey}`;

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
    if (!this.isHealthy()) {
      throw new Error(`Gemini is rate-limited. Status: ${this.health.status}`);
    }

    try {
      this.provider.callCount++;
      const startTime = Date.now();
      const content = await this.callGemini(messages, options);
      const duration = Date.now() - startTime;
      this.markHealthy();

      return {
        content,
        provider: this.provider.id,
        duration,
      };
    } catch (err) {
      if (err.code === 429) {
        this.markRateLimited(err.retryAfter);
      }
      throw err;
    }
  }

  getStats() {
    return {
      provider: {
        id: this.provider.id,
        type: this.provider.type,
        model: this.provider.model,
        callCount: this.provider.callCount,
        health: this.health,
      },
      totalCalls: this.provider.callCount,
    };
  }
}

export { LLMProviderManager };
