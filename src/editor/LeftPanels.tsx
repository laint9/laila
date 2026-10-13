// Panel trái: Effects & Presets (In/Out/Loop, text animator), Align, chèn nhanh brand element.
import { Icon } from '../components/Icon'
import { applyPreset, newImageLayer, newTextLayer, PRESET_GROUPS } from '../engine/edit'
import { defaultAnimator } from '../engine/normalize'
import { layerCorners, parentSpace } from '../engine/render'
import type { Layer, TextPreset } from '../engine/types'
import { useEditorCtx } from './context'
import { Section } from './fields'
import { selectedLayer, useEditor } from './state'

const TEXT_QUICK: { label: string; preset: TextPreset; unit: 'char' | 'word' | 'line'; stagger?: number }[] = [
  { label: 'Dòng trồi lên', preset: 'mask', unit: 'line', stagger: 0.12 },
  { label: 'Từ trượt lên', preset: 'slideUp', unit: 'word' },
  { label: 'Ký tự blur', preset: 'blur', unit: 'char', stagger: 0.025 },
  { label: 'Ký tự nảy', preset: 'scale', unit: 'char', stagger: 0.03 },
  { label: 'Đánh máy', preset: 'typewriter', unit: 'char' },
  { label: 'Fade từng từ', preset: 'fade', unit: 'word' }
]

export function LeftPanels() {
  const layer = useEditor(selectedLayer)
  const time = useEditor((s) => s.time)
  const scene = useEditor((s) => s.scene)
  const duration = useEditor((s) => s.duration)
  const ed = useEditor.getState
  const { runner, W, H, elements } = useEditorCtx()

  const align = (where: 'l' | 'ch' | 'r' | 't' | 'cv' | 'b') => {
    if (!layer || !runner.assets) return
    const ctx = new OffscreenCanvas(8, 8).getContext('2d')!
    const c = layerCorners(ctx, scene, layer, time, runner.assets)
    const xs = c.pts.map((p) => p.x)
    const ys = c.pts.map((p) => p.y)
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys)
    let dx = 0,
      dy = 0
    if (where === 'l') dx = -minX
    if (where === 'r') dx = W - maxX
    if (where === 'ch') dx = W / 2 - (minX + maxX) / 2
    if (where === 't') dy = -minY
    if (where === 'b') dy = H - maxY
    if (where === 'cv') dy = H / 2 - (minY + maxY) / 2
    const inv = parentSpace(scene, layer, time).inverse()
    const a = inv.transformPoint(new DOMPoint(0, 0))
    const b = inv.transformPoint(new DOMPoint(dx, dy))
    const shift = (p: Layer['transform']['x'], d: number) => ({ ...p, v: p.v + d, keys: p.keys?.map((k) => ({ ...k, v: k.v + d })) })
    ed().editLayer(layer.id, (l) => ({ ...l, transform: { ...l.transform, x: shift(l.transform.x, b.x - a.x), y: shift(l.transform.y, b.y - a.y) } }))
  }

  const addLayer = (l: Layer) => {
    ed().edit((sc) => ({ ...sc, layers: [l, ...sc.layers] }))
    ed().select(l.id)
  }

  const brandTexts = elements.filter((e) => e.kind === 'text')
  const brandImages = elements.filter((e) => e.kind === 'image' && e.value)
  const brandFont = elements.find((e) => e.kind === 'font')?.name ?? ''

  return (
    <div className="left-panels">
      <Section title="Hiệu ứng chuyển động">
        {!layer && <p className="hint">Chọn một layer rồi bấm hiệu ứng. Hiệu ứng tạo keyframe thật, chỉnh tiếp được trên timeline.</p>}
        {PRESET_GROUPS.map((g) => (
          <div key={g.label} className="preset-group">
            <div className="preset-label">{g.label}</div>
            <div className="preset-grid">
              {g.items.map((it) => (
                <button key={it.id} title={it.label} disabled={!layer || layer.locked} onClick={() => layer && ed().editLayer(layer.id, (l) => applyPreset(l, it.id, H))}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {layer?.type === 'text' && (
        <Section title="Hiệu ứng chữ">
          <div className="preset-grid">
            {TEXT_QUICK.map((q) => (
              <button
                key={q.label}
                onClick={() =>
                  ed().editLayer(layer.id, (l) =>
                    l.type === 'text' ? { ...l, text: { ...l.text, animIn: { ...defaultAnimator(q.preset), unit: q.unit, stagger: q.stagger ?? defaultAnimator(q.preset).stagger } } } : l
                  )
                }
              >
                {q.label}
              </button>
            ))}
            <button
              onClick={() =>
                ed().editLayer(layer.id, (l) => (l.type === 'text' ? { ...l, text: { ...l.text, animOut: l.text.animIn ? { ...l.text.animIn } : defaultAnimator('fade') } } : l))
              }
            >
              Ra = giống Vào
            </button>
          </div>
        </Section>
      )}

      <Section title="Căn chỉnh (Align)">
        <div className="align-row">
          {(
            [
              ['l', 'alignL', 'Căn trái'],
              ['ch', 'alignCH', 'Giữa ngang'],
              ['r', 'alignR', 'Căn phải'],
              ['t', 'alignT', 'Căn trên'],
              ['cv', 'alignCV', 'Giữa dọc'],
              ['b', 'alignB', 'Căn dưới']
            ] as const
          ).map(([k, icon, title]) => (
            <button key={k} className="tbtn" title={title} disabled={!layer} onClick={() => align(k)}>
              <Icon name={icon} />
            </button>
          ))}
        </div>
      </Section>

      <Section title="Chèn từ Brand kit" defaultOpen={brandTexts.length + brandImages.length > 0}>
        {brandTexts.map((e) => (
          <button key={e.id} className="brand-insert" onClick={() => addLayer({ ...newTextLayer(W, H, duration, e.value, brandFont), name: e.name })}>
            <Icon name="text" size={13} /> {e.name}
            <span className="muted small"> {e.value.slice(0, 24)}</span>
          </button>
        ))}
        {brandImages.map((e) => (
          <button key={e.id} className="brand-insert" onClick={() => addLayer(newImageLayer(W, H, duration, e.name))}>
            <Icon name="image" size={13} /> {e.name}
          </button>
        ))}
        {brandTexts.length + brandImages.length === 0 && <p className="hint">Brand kit chưa có text/ảnh.</p>}
      </Section>
    </div>
  )
}
