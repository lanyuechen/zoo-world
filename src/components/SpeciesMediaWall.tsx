import { useEffect, useEffectEvent, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { SpeciesMediaItem } from '../types/species'

const MIN_SCALE = 1
const MAX_SCALE = 6

function mediaCaption(m: SpeciesMediaItem): string {
  return [m.label, m.source && `来源：${m.source}`, m.rightsHolder && `权利人：${m.rightsHolder}`]
    .filter(Boolean)
    .join(' · ')
}

function clampScale(n: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))
}

type SlideDir = 'next' | 'prev' | null

type Props = {
  media: SpeciesMediaItem[]
  altFallback: string
}

export default function SpeciesMediaWall({ media, altFallback }: Props) {
  const titleId = useId()
  const [active, setActive] = useState<number | null>(null)
  const [slideDir, setSlideDir] = useState<SlideDir>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(
    null,
  )

  const close = useEffectEvent(() => {
    setActive(null)
    setSlideDir(null)
  })

  const step = useEffectEvent((delta: number) => {
    setSlideDir(delta > 0 ? 'next' : 'prev')
    setActive((i) => {
      if (i === null || media.length === 0) return i
      return (i + delta + media.length) % media.length
    })
  })

  const openAt = (index: number) => {
    setSlideDir(null)
    setActive(index)
  }

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 })
    setDragging(false)
    dragRef.current = null
  }, [active])

  useEffect(() => {
    if (active === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [active])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || active === null) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12

      setView((prev) => {
        const nextScale = clampScale(prev.scale * factor)
        if (nextScale === prev.scale) return prev
        if (nextScale === MIN_SCALE) return { scale: MIN_SCALE, x: 0, y: 0 }
        const ratio = nextScale / prev.scale
        return {
          scale: nextScale,
          x: mx - (mx - prev.x) * ratio,
          y: my - (my - prev.y) * ratio,
        }
      })
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [active])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.species-media-lightbox-nav')) return
    dragRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      ox: view.x,
      oy: view.y,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    setView((prev) => ({
      ...prev,
      x: drag.ox + (e.clientX - drag.x),
      y: drag.oy + (e.clientY - drag.y),
    }))
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  if (media.length === 0) return null

  const layout = media.length <= 2 ? 'species-media-wall--few' : 'species-media-wall--many'
  const current = active !== null ? media[active] : null
  const caption = current ? mediaCaption(current) : ''
  const slideClass =
    slideDir === 'next'
      ? 'species-media-lightbox-slide is-enter-next'
      : slideDir === 'prev'
        ? 'species-media-lightbox-slide is-enter-prev'
        : 'species-media-lightbox-slide'

  return (
    <>
      <ul className={`species-media-wall ${layout}`}>
        {media.map((m, i) => {
          const cap = mediaCaption(m)
          return (
            <li key={m.url} className="species-media-tile">
              <button
                type="button"
                className="species-media-thumb"
                onClick={() => openAt(i)}
                aria-label={cap ? `查看大图：${cap}` : `查看大图 ${i + 1}`}
              >
                <img src={m.url} alt={m.label || altFallback} loading="lazy" />
              </button>
              {cap ? <p className="species-media-caption">{cap}</p> : null}
            </li>
          )
        })}
      </ul>

      {current && active !== null && (
        <div
          className="species-media-lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={close}
        >
          <button
            type="button"
            className="species-media-lightbox-close"
            onClick={close}
            aria-label="关闭"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div
            className="species-media-lightbox-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <p id={titleId} className="visually-hidden">
              影像预览，滚轮缩放，按住拖动
            </p>

            <div
              ref={stageRef}
              className={
                dragging
                  ? 'species-media-lightbox-stage is-dragging'
                  : 'species-media-lightbox-stage'
              }
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div key={current.url} className={slideClass}>
                <img
                  src={current.url}
                  alt={current.label || altFallback}
                  className="species-media-lightbox-img"
                  draggable={false}
                  style={{
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  }}
                />
              </div>
              {media.length > 1 && (
                <>
                  <button
                    type="button"
                    className="species-media-lightbox-nav species-media-lightbox-nav--prev"
                    onClick={() => step(-1)}
                    aria-label="上一张"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M14.5 5.5 8 12l6.5 6.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="species-media-lightbox-nav species-media-lightbox-nav--next"
                    onClick={() => step(1)}
                    aria-label="下一张"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9.5 5.5 16 12l-6.5 6.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {media.length > 1 && (
              <p className="species-media-lightbox-count">
                {active + 1} / {media.length}
              </p>
            )}
            {caption ? <p className="species-media-lightbox-caption">{caption}</p> : null}
          </div>
        </div>
      )}
    </>
  )
}
