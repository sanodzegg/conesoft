// Runs a single Lighthouse audit in an Electron utilityProcess. Lighthouse's trace
// processing is CPU-heavy — running it in the main process would block the event loop
// (all IPC, window events) for seconds at a time, and the desktop+mobile audits run in
// parallel. One worker per audit keeps them genuinely parallel like the old CLI did.
//
// Receives { url, strategy, chromiumPath } via parentPort, posts back the compact
// result shape the renderer expects ({ success, scores, webVitals, topIssues }).
// Lighthouse is ESM-only, hence the dynamic import()s from this CJS script.

function buildResult(lhr) {
  const cats = lhr.categories
  const audits = lhr.audits

  return {
    success: true,
    scores: {
      performance: Math.round((cats.performance?.score ?? 0) * 100),
      accessibility: Math.round((cats.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
      seo: Math.round((cats.seo?.score ?? 0) * 100),
    },
    webVitals: {
      lcp: audits['largest-contentful-paint']?.displayValue ?? null,
      fcp: audits['first-contentful-paint']?.displayValue ?? null,
      cls: audits['cumulative-layout-shift']?.displayValue ?? null,
      tbt: audits['total-blocking-time']?.displayValue ?? null,
      si: audits['speed-index']?.displayValue ?? null,
    },
    topIssues: Object.values(audits)
      .filter((a) => a.score !== null && a.score < 0.9 && a.details?.type !== 'debugdata')
      .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
      .slice(0, 10)
      .map((a) => {
        // Extract detail rows from the audit's details table
        let items = []
        const d = a.details
        if (d && (d.type === 'table' || d.type === 'opportunity') && Array.isArray(d.items)) {
          items = d.items.slice(0, 5).map((item) => {
            const row = {}
            // Pull out the most useful fields from each row
            if (item.node?.snippet) row.node = item.node.snippet
            if (item.node?.nodeLabel) row.nodeLabel = item.node.nodeLabel
            if (item.url) row.url = typeof item.url === 'string' ? item.url : item.url?.value ?? null
            if (item.source?.url) row.url = item.source.url
            if (item.label) row.label = item.label
            if (item.groupLabel) row.label = item.groupLabel
            if (item.duration != null) row.duration = Math.round(item.duration) + ' ms'
            if (item.wastedMs != null) row.wastedMs = Math.round(item.wastedMs) + ' ms'
            if (item.wastedBytes != null) row.wastedBytes = Math.round(item.wastedBytes / 1024) + ' KB'
            if (item.totalBytes != null) row.totalBytes = Math.round(item.totalBytes / 1024) + ' KB'
            if (item.transferSize != null) row.transferSize = Math.round(item.transferSize / 1024) + ' KB'
            if (item.cacheLifetimeMs != null) row.cacheLifetime = Math.round(item.cacheLifetimeMs / 1000) + ' s'
            return row
          }).filter((row) => Object.keys(row).length > 0)
        }
        return {
          id: a.id,
          title: a.title,
          description: a.description
            ? a.description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').slice(0, 200)
            : null,
          score: a.score,
          displayValue: a.displayValue ?? null,
          items,
        }
      }),
  }
}

process.parentPort.on('message', async (e) => {
  const { url, strategy, chromiumPath } = e.data
  let chrome = null
  try {
    const { default: lighthouse } = await import('lighthouse')
    const { launch } = await import('chrome-launcher')

    chrome = await launch({
      chromePath: chromiumPath,
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions'],
    })

    const config = strategy === 'desktop'
      ? (await import('lighthouse/core/config/desktop-config.js')).default
      : undefined

    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      logLevel: 'error',
    }, config)

    process.parentPort.postMessage(buildResult(result.lhr))
  } catch (err) {
    process.parentPort.postMessage({ success: false, error: err?.message ?? String(err) })
  } finally {
    try { if (chrome) await chrome.kill() } catch {}
    process.exit(0)
  }
})
