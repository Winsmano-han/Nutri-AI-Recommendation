/**
 * Parallel Batch Processor
 * Processes multiple restaurants in parallel batches to maximize throughput
 * while respecting rate limits through provider distribution
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BatchProcessor {
  constructor(llmManager, config = {}) {
    this.llmManager = llmManager;
    this.batchSize = config.batchSize || 3; // Conservative: 1 per provider initially
    this.batchDelay = config.batchDelay || 500; // 500ms between batches
    this.maxConcurrent = config.maxConcurrent || 10; // Max parallel calls
  }

  async processBatch(items, processFn) {
    const results = await Promise.allSettled(
      items.map(async (item) => {
        try {
          return await processFn(item);
        } catch (err) {
          return {
            success: false,
            error: err.message,
            item,
          };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return { success: true, data: result.value, item: items[index] };
      }
      return { success: false, error: result.reason?.message || "Unknown error", item: items[index] };
    });
  }

  async processAll(items, processFn, options = {}) {
    const batchSize = options.batchSize || this.batchSize;
    const batchDelay = options.batchDelay || this.batchDelay;

    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    console.log(`📦 Processing ${items.length} items in ${batches.length} batches (size: ${batchSize})`);

    const allResults = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`\n🔄 Batch ${i + 1}/${batches.length} (${batch.length} items)...`);

      const batchResults = await this.processBatch(batch, processFn);

      for (const result of batchResults) {
        allResults.push(result);
        if (result.success) {
          successCount++;
          console.log(`  ✅ Success (provider: ${result.data.provider || "unknown"})`);
        } else {
          failCount++;
          console.log(`  ❌ Failed: ${result.error}`);
        }
      }

      // Delay between batches (except for last batch)
      if (i < batches.length - 1) {
        await sleep(batchDelay);
      }
    }

    console.log(`\n📊 Batch Processing Complete:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   📈 Success Rate: ${((successCount / items.length) * 100).toFixed(1)}%`);

    return {
      results: allResults,
      stats: {
        total: items.length,
        success: successCount,
        failed: failCount,
        successRate: (successCount / items.length) * 100,
      },
    };
  }
}

export { BatchProcessor };
