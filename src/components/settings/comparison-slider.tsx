import { useRef, useState, useCallback, useEffect } from 'react'
import presentationImg from '@/assets/presentation.jpg'
import presentationImgLight from '@/assets/presentation-light.jpg'
import { useTheme } from '../theme/theme-provider'

interface Props {
  quality: number
  format?: string
  imageSrc?: string
  onSizes?: (original: number, compressed: number) => void
  onEncodingChange?: (encoding: boolean) => void
  zoom?: number
}

export default function ComparisonSlider({ quality, format = 'jpeg', imageSrc, onSizes, onEncodingChange, zoom = 1 }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [compressedSrc, setCompressedSrc] = useState<string | null>(null)
  const [encoding, setEncoding] = useState(false)
  const [position, setPosition] = useState(50)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const sourceBufferRef = useRef<ArrayBuffer | null>(null)
  const sliderDragging = useRef(false)
  const panDragging = useRef(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const onSizesRef = useRef(onSizes)
  onSizesRef.current = onSizes
  const onEncodingChangeRef = useRef(onEncodingChange)
  onEncodingChangeRef.current = onEncodingChange
  const encodeIdRef = useRef(0)

  const { theme } = useTheme()
  const fallbackSrc = theme === 'dark' ? presentationImg : presentationImgLight
  const displaySrc = imageSrc ?? fallbackSrc

  // Reset pan when zoom returns to 1
  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 })
  }, [zoom])

  // Clamp pan so image edges don't go past the container
  const clampPan = useCallback((x: number, y: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x, y }
    const maxX = (rect.width * (zoom - 1)) / 2
    const maxY = (rect.height * (zoom - 1)) / 2
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }, [zoom])

  async function encode(buffer: ArrayBuffer, q: number, fmt: string) {
    const id = ++encodeIdRef.current
    setEncoding(true)
    onEncodingChangeRef.current?.(true)
    try {
      const result = await window.electron.convert(buffer, fmt, q)
      if (id !== encodeIdRef.current) return
      if (onSizesRef.current) onSizesRef.current(buffer.byteLength, result.byteLength)
      const blob = new Blob([result], { type: `image/${fmt}` })
      const url = URL.createObjectURL(blob)
      setCompressedSrc(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    } catch (e) {
      console.error('[ComparisonSlider] encode failed:', e)
    } finally {
      if (id === encodeIdRef.current) {
        setEncoding(false)
        onEncodingChangeRef.current?.(false)
      }
    }
  }

  useEffect(() => {
    if (!sourceBufferRef.current) return
    const timer = setTimeout(() => encode(sourceBufferRef.current!, quality, format), 300)
    return () => clearTimeout(timer)
  }, [quality, format])

  useEffect(() => {
    if (!imageSrc) return
    encodeIdRef.current++
    setLoaded(false)
    setCompressedSrc(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    sourceBufferRef.current = null
  }, [imageSrc])

  async function onImgLoad({ currentTarget }: React.SyntheticEvent<HTMLImageElement>) {
    setLoaded(true)
    try {
      const res = await fetch(currentTarget.src)
      const buffer = await res.arrayBuffer()
      sourceBufferRef.current = buffer
      await encode(buffer, quality, format)
    } catch (e) {
      console.error('[ComparisonSlider] fetch failed:', e)
    }
  }

  const updateSliderPosition = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }, [])

  // Slider handle drag — takes priority, does not pan
  const onSliderMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    sliderDragging.current = true
    e.preventDefault()
    const onMove = (e: MouseEvent) => { if (sliderDragging.current) updateSliderPosition(e.clientX) }
    const onUp = () => {
      sliderDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onSliderTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation()
    const onMove = (e: TouchEvent) => updateSliderPosition(e.touches[0].clientX)
    const onEnd = () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onEnd)
  }

  // Container drag — pan when zoomed, otherwise move slider
  const onContainerMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      panDragging.current = true
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
      e.preventDefault()
      const onMove = (e: MouseEvent) => {
        if (!panDragging.current) return
        const dx = e.clientX - panStart.current.x
        const dy = e.clientY - panStart.current.y
        setPan(clampPan(panStart.current.panX + dx, panStart.current.panY + dy))
      }
      const onUp = () => {
        panDragging.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    } else {
      sliderDragging.current = true
      e.preventDefault()
      updateSliderPosition(e.clientX)
      const onMove = (e: MouseEvent) => { if (sliderDragging.current) updateSliderPosition(e.clientX) }
      const onUp = () => {
        sliderDragging.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }

  const imgStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
    transformOrigin: 'center',
    ...extra,
  })

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-xl overflow-hidden select-none"
      style={{ aspectRatio: '16/7', cursor: zoom > 1 ? 'grab' : 'col-resize' }}
      onMouseDown={onContainerMouseDown}
    >
      {/* Compressed (right side) */}
      {compressedSrc ? (
        <img
          src={compressedSrc}
          alt="compressed"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-300"
          style={imgStyle({ filter: encoding ? 'blur(6px)' : 'none' })}
        />
      ) : (
        <img
          src={displaySrc}
          alt="placeholder"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
          style={imgStyle({ filter: 'blur(12px)' })}
        />
      )}

      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img
          src={displaySrc}
          alt="original"
          draggable={false}
          onLoad={onImgLoad}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={imgStyle({ opacity: loaded ? 1 : 0 })}
        />
      </div>

      {loaded && (
        <div
          className="absolute top-0 bottom-0 w-8 2xl:w-10 -translate-x-1/2 flex items-center justify-center cursor-col-resize"
          style={{ left: `${position}%` }}
          onMouseDown={onSliderMouseDown}
          onTouchStart={onSliderTouchStart}
        >
          <div className="w-px h-full bg-white/70 shadow-[0_0_6px_rgba(0,0,0,0.5)]" />
          <div className="absolute top-1/2 -translate-y-1/2 w-8 h-8 2xl:w-10 2xl:h-10 rounded-full bg-white shadow-lg flex items-center justify-center cursor-col-resize">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="2xl:scale-125">
              <path d="M5 4L2 8L5 12" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 4L14 8L11 12" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {loaded && (
        <>
          <span className="absolute bottom-2 left-3 text-[10px] 2xl:text-xs font-semibold text-white/90 bg-black/40 px-1.5 2xl:px-2 py-0.5 rounded pointer-events-none">Original</span>
          <span className="absolute bottom-2 right-3 text-[10px] 2xl:text-xs font-semibold text-white/90 bg-black/40 px-1.5 2xl:px-2 py-0.5 rounded pointer-events-none">Quality {quality}%</span>
        </>
      )}
    </div>
  )
}
