import { createElement } from 'react'
import { getEngineForFile } from '@/engines/engineRegistry'
import { fileKey } from '@/utils/fileUtils'
import type { ConvertStore } from '@/store/useConvertStore'
import { isTrialExhausted, incrementLocalCount, getTrialScore, getLocalCounts, getDailyCounts, LIMITED_DAILY_LIMITS, WEIGHTS } from '@/lib/useConversionCount'
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

async function convertFile(file: File, filePlan: string, deps: ConversionDeps): Promise<void> {
  const engine = getEngineForFile(file)
  if (!engine) {
    deps.setFailedFile(file, 'No engine available for this file type')
    return
  }

  const limitType = toEngineType(engine.id)

  // Reserve slot upfront for all plan types — plan is already resolved per-file
  // before dispatch so parallel conversions use the correct bucket.
  let refund = () => {}
  if (limitType) {
    const [r, reserved] = incrementLocalCount(limitType, filePlan)
    if (!reserved) {
      const label = limitType.charAt(0).toUpperCase() + limitType.slice(1)
      const msg = filePlan === 'limited' || isTrialExhausted()
        ? `${label} daily limit reached. Try again tomorrow or upgrade to Pro.`
        : `${label} conversion limit reached. Upgrade to continue.`
      deps.setFailedFile(file, msg)
      return
    }
    refund = r
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

  // If trial is already exhausted, flip before dispatching so the whole batch
  // runs under limited (daily) rules from the start.
  if (deps.plan === 'trial' && getTrialScore(getLocalCounts()) >= 1.0) {
    deps.onPlanExhausted?.()
    deps.plan = 'limited'
  }

  // Assign each file its effective plan before dispatch using a single shared score
  // pool — each engine draws from the same remaining budget. Per-engine independent
  // budgets were wrong: they each got floor(remaining/weight) slots, letting all
  // engines over-allocate far beyond the actual remaining score.
  const filePlans: Map<File, string> = new Map()
  let needsPlanFlip = false

  if (deps.plan === 'trial') {
    let remainingScore = 1.0 - getTrialScore(getLocalCounts())
    for (const f of pending) {
      const engineId = getEngineForFile(f)?.id ?? ''
      const limitType = toEngineType(engineId)
      if (!limitType) { filePlans.set(f, 'trial'); continue }
      const cost = WEIGHTS[limitType]
      // 1e-9 epsilon absorbs FP drift so an exactly-fitting file isn't wrongly rejected
      if (remainingScore >= cost - 1e-9) {
        filePlans.set(f, 'trial')
        remainingScore -= cost
      } else {
        filePlans.set(f, 'limited')
        needsPlanFlip = true
      }
    }
  } else {
    for (const f of pending) filePlans.set(f, deps.plan)
  }

  if (needsPlanFlip) {
    deps.onPlanExhausted?.()
  }

  // Pre-flight: count how many files will be blocked by the daily limit.
  // Files assigned 'limited' plan compete for the daily bucket; check upfront
  // so we can skip them cleanly and show one clear toast instead of per-file errors.
  const dailyNow = getDailyCounts()
  const dailyUsed: Record<string, number> = {
    image: dailyNow.image,
    document: dailyNow.document,
    video: dailyNow.video,
    audio: dailyNow.audio,
  }
  const blockedByDaily = new Set<File>()

  for (const f of pending) {
    if (filePlans.get(f) !== 'limited') continue
    const engineId = getEngineForFile(f)?.id ?? ''
    const limitType = toEngineType(engineId)
    if (!limitType) continue
    const used = dailyUsed[limitType] ?? 0
    if (used >= LIMITED_DAILY_LIMITS[limitType]) {
      blockedByDaily.add(f)
    } else {
      dailyUsed[limitType] = used + 1
    }
  }

  if (blockedByDaily.size > 0) {
    const n = blockedByDaily.size
    toast.warning(`${n} file${n !== 1 ? 's' : ''} skipped — daily limit reached`, {
      description: createElement('span', null,
        'These files will be available again tomorrow. ',
        createElement('button', {
          onClick: () => deps.onNavigateToPricing?.(),
          style: { textDecoration: 'underline', cursor: 'pointer' },
        }, 'Upgrade to Pro')
      ),
      duration: 6000,
    })
    for (const f of blockedByDaily) {
      deps.setFailedFile(f, 'Daily limit reached. Try again tomorrow or upgrade to Pro.')
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
    images.map((f) => () => convertFile(f, filePlans.get(f) ?? deps.plan, wrappedDeps)),
    IMAGE_CONCURRENCY
  )

  const nonImagePromise = (async () => {
    for (const f of nonImages) {
      await convertFile(f, filePlans.get(f) ?? deps.plan, wrappedDeps)
    }
  })()

  await Promise.all([imagePromise, nonImagePromise])

  deps.onBatchComplete?.(successCount, dispatchPending.length)
}
