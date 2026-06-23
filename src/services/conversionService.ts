import { createElement } from 'react'
import { getEngineForFile } from '@/engines/engineRegistry'
import { fileKey } from '@/utils/fileUtils'
import type { ConvertStore } from '@/store/useConvertStore'
import { isTrialExhausted, spendTokens, getTokensUsed, getDailyTokens, TOKEN_COSTS, TRIAL_TOKEN_LIMIT, DAILY_TOKEN_LIMIT } from '@/lib/useConversionCount'
import { toEngineType } from '@/lib/ConversionCountContext'
import { toast } from 'sonner'

type ConversionDeps = Pick<
  ConvertStore,
  | 'quality'
  | 'imageQuality'
  | 'fileSettings'
  | 'convertedFiles'
  | 'convertingFiles'
  | 'startConversion'
  | 'setConvertedFile'
  | 'setFailedFile'
  | 'markFileConverting'
  | 'unmarkFileConverting'
  | 'removeFile'
> & {
  plan: string
  onPlanExhausted?: () => void
  onConversionSuccess?: (engineId: string) => void
  onBatchComplete?: (successCount: number, totalCount: number) => void
  onNavigateToPricing?: () => void
}

function getDefaultQualityForFile(file: File, deps: ConversionDeps): number {
  const engineId = getEngineForFile(file)?.id
  if (engineId === 'image') return deps.imageQuality
  return deps.quality
}

export async function convertSingle(file: File, deps: ConversionDeps): Promise<void> {
  await convertAll([file], deps)
}

// Live homepage reservations, keyed by fileKey. spendTokens commits the spend to localStorage
// synchronously before the async engine runs; if the page is reloaded mid-batch the try/catch
// refund below never fires and those tokens leak. We mirror each in-flight reservation here and
// reverse any still outstanding on unload, so a refresh can't burn tokens for conversions that
// never produced a downloadable result. Files that settle (success or failure) remove themselves,
// so only genuinely in-flight files are refunded.
const inFlightRefunds = new Map<string, () => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    inFlightRefunds.forEach((refund) => refund())
  })
}

async function convertFile(file: File, filePlan: string, deps: ConversionDeps): Promise<void> {
  const engine = getEngineForFile(file)
  if (!engine) {
    deps.setFailedFile(file, 'Unsupported file type')
    return
  }

  const limitType = toEngineType(engine.id)
  const key = fileKey(file)

  // Reserve slot upfront for all plan types - plan is already resolved per-file before dispatch
  // so parallel conversions use the correct bucket. The reservation is mirrored in inFlightRefunds
  // so a mid-batch reload refunds it; refund()/commit() are guarded to fire at most once (the
  // unload sweep and the failure path must not double-reverse).
  let settled = false
  let refund = () => {}
  if (limitType) {
    const [r, reserved] = spendTokens(limitType, filePlan)
    if (!reserved) {
      const msg = filePlan === 'limited' || isTrialExhausted()
        ? 'Not enough tokens left today. They refresh tomorrow - or upgrade to Pro.'
        : 'Not enough trial tokens left. Upgrade to keep converting.'
      deps.setFailedFile(file, msg)
      return
    }
    refund = () => {
      if (settled) return
      settled = true
      inFlightRefunds.delete(key)
      r()
    }
    inFlightRefunds.set(key, refund)
  }
  // Conversion committed: drop it from the unload registry without reversing the spend.
  const commit = () => {
    if (settled) return
    settled = true
    inFlightRefunds.delete(key)
  }

  const settings = deps.fileSettings[fileKey(file)]
  const targetFormat = settings?.targetFormat
  if (!targetFormat) {
    refund()
    deps.setFailedFile(file, 'No target format selected')
    return
  }

  const quality = settings.quality ?? getDefaultQualityForFile(file, deps)

  try {
    deps.markFileConverting(file)
    const blob = await engine.convert(file, targetFormat, {
      quality,
      width: settings.width,
      height: settings.height,
      fit: settings.fit,
      keepMetadata: settings.keepMetadata,
    })
    deps.setConvertedFile(file, blob)
    deps.unmarkFileConverting(file)
    deps.removeFile(file)
    commit()
    deps.onConversionSuccess?.(engine.id)
  } catch (err) {
    refund()
    deps.unmarkFileConverting(file)
    deps.setFailedFile(file, err instanceof Error ? err.message : (err as any)?.message ?? String(err) ?? 'Unknown error')
  }
}

const IMAGE_CONCURRENCY = 4

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
  let i = 0
  async function worker() {
    while (i < tasks.length) {
      await tasks[i++]().catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

export async function convertAll(files: File[], deps: ConversionDeps): Promise<void> {
  const pending = files.filter((f) => !deps.convertedFiles[fileKey(f)])
  if (pending.length === 0) return

  deps.startConversion(pending)

  // If trial is already exhausted entering the batch, flip up front so state/UI reflect it.
  if (deps.plan === 'trial' && getTokensUsed() >= TRIAL_TOKEN_LIMIT) {
    deps.onPlanExhausted?.()
    deps.plan = 'limited'
  }

  // Pre-flight (free tiers): simulate the trial→daily spill so we can skip files the combined
  // budget can't cover and show one clear toast instead of per-file errors. spendTokens drains
  // the lifetime trial budget first, then spills the remainder into the daily allowance - a
  // single conversion can straddle the boundary (e.g. 7 trial + 1 daily). Mid-batch trial
  // exhaustion is handled by onConversionSuccess (main.tsx) once tokens_used hits the cap.
  const blockedByDaily = new Set<File>()
  if (deps.plan === 'trial' || deps.plan === 'limited') {
    let simTrial = getTokensUsed()
    let simDaily = getDailyTokens()
    for (const f of pending) {
      const limitType = toEngineType(getEngineForFile(f)?.id ?? '')
      if (!limitType) continue
      const cost = TOKEN_COSTS[limitType]
      const trialPart = Math.min(cost, Math.max(0, TRIAL_TOKEN_LIMIT - simTrial))
      const dailyPart = cost - trialPart
      if (dailyPart > 0 && simDaily + dailyPart > DAILY_TOKEN_LIMIT) {
        blockedByDaily.add(f)
      } else {
        simTrial += trialPart
        simDaily += dailyPart
      }
    }
  }

  if (blockedByDaily.size > 0) {
    const n = blockedByDaily.size
    toast.warning(`${n} file${n !== 1 ? 's' : ''} skipped - not enough tokens today`, {
      description: createElement('span', null,
        'Your daily tokens refresh tomorrow. ',
        createElement('button', {
          onClick: () => deps.onNavigateToPricing?.(),
          style: { textDecoration: 'underline', cursor: 'pointer' },
        }, 'Upgrade to Pro')
      ),
      duration: 6000,
    })
    for (const f of blockedByDaily) {
      deps.setFailedFile(f, 'Not enough tokens left today. They refresh tomorrow - or upgrade to Pro.')
    }
  }

  const dispatchPending = pending.filter(f => !blockedByDaily.has(f))
  if (dispatchPending.length === 0) return

  let successCount = 0
  const wrappedDeps = {
    ...deps,
    onConversionSuccess: (engineId: string) => {
      successCount++
      deps.onConversionSuccess?.(engineId)
    },
  }

  const images = dispatchPending.filter((f) => getEngineForFile(f)?.id === 'image')
  const nonImages = dispatchPending.filter((f) => getEngineForFile(f)?.id !== 'image')

  const imagePromise = runWithConcurrency(
    images.map((f) => () => convertFile(f, deps.plan, wrappedDeps)),
    IMAGE_CONCURRENCY
  )

  const nonImagePromise = (async () => {
    for (const f of nonImages) {
      await convertFile(f, deps.plan, wrappedDeps)
    }
  })()

  await Promise.all([imagePromise, nonImagePromise])

  deps.onBatchComplete?.(successCount, dispatchPending.length)
}
