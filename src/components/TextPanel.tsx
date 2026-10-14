// Tab "Chữ": thư viện mẫu chữ / hình (bấm hoặc kéo thả lên khung xem) và bảng chỉnh clip chữ đang chọn.
import type { GraphicData } from '../../shared/types'
import { findTrackClip, useStore } from '../lib/store'
import { GRAPHIC_LEN, graphicLabel, SHAPE_PRESETS, shapePreset, TEXT_PRESETS, textPreset, type ShapePresetId, type TextPresetId } from '../lib/graphics'
import { PRESET_GROUPS } from '../engine/edit'
import { defaultAnimator } from '../engine/normalize'
import type { Layer, ShapeLayer, TextData, TextLayer, TextPreset } from '../engine/types'
import { ColorField, NumberField, Section, Segmented } from '../editor/fields'
import { FontPicker } from './FontPicker'
import { Icon } from './Icon'

/** Dữ liệu kéo thả từ thư viện lên khung xem */
export const DRAG_GRAPHIC = 'text/laila-graphic'
export type GraphicDrag = { kind: 'text'; id: TextPresetId; content?: string } | { kind: 'shape'; id: ShapePresetId; color?: string }

/** Tạo clip chữ / hình tại playhead, ở vị trí `at` (toạ độ khung hình) */
export function addGraphicFromDrag(d: GraphicDrag, at?: { x: number; y: number }) {
  const st = useStore.getState()
  const s = st.project.settings
  const layer = d.kind === 'text' ? textPreset(d.id, s, at, d.content) : shapePreset(d.id, s, at, d.color)
  return st.addGraphic({ layer: layer as unknown as Record<string, unknown> }, st.playhead, GRAPHIC_LEN)
}

const TEXT_ANIMS: { value: TextPreset | 'none'; label: string }[] = [
  { value: 'none', label: 'Không' },
  { value: 'fade', label: 'Hiện dần' },
  { value: 'slideUp', label: 'Trượt lên' },
  { value: 'slideDown', label: 'Trượt xuống' },
  { value: 'slideLeft', label: 'Trượt ngang' },
  { value: 'scale', label: 'Phóng to' },
  { value: 'blur', label: 'Blur' },
  { value: 'typewriter', label: 'Đánh máy' },
  { value: 'mask', label: 'Trồi từ vạch' },
  { value: 'rotate', label: 'Xoay' }
]
const MOTION_IN = PRESET_GROUPS[0].items
const MOTION_OUT = PRESET_GROUPS[1].items

export function TextPanel() {
  const selectedId = useStore((s) => s.selectedClipId)
  const project = useStore((s) => s.project)
  const tc = findTrackClip(project, selectedId)
  if (tc?.clip.graphic) return <GraphicInspector key={tc.clip.id} clipId={tc.clip.id} g={tc.clip.graphic} len={tc.clip.out - tc.clip.in} />
  return <Library />
}

function Library() {
  const elements = useStore((s) => s.project.elements)
  const colors = elements.filter((e) => e.kind === 'color').map((e) => e.value)
  const texts = elements.filter((e) => e.kind === 'text' && e.value.trim())
  const drag = (d: GraphicDrag) => (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_GRAPHIC, JSON.stringify(d))
    e.dataTransfer.effectAllowed = 'copy'
  }
  return (
    <div className="panel-body text-lib">
      <p className="hint">Bấm để thêm tại playhead, hoặc kéo thả thẳng lên khung xem video để đặt đúng chỗ.</p>
      <div className="lib-title">Chữ</div>
      <div className="lib-grid">
        {TEXT_PRESETS.map((p) => (
          <button key={p.id} className={'lib-card t-' + p.id} draggable onDragStart={drag({ kind: 'text', id: p.id })} onClick={() => addGraphicFromDrag({ kind: 'text', id: p.id })}>
            <span className="lib-sample">{p.id === 'paragraph' ? 'Aa Bb\nCc Dd' : p.sample}</span>
            <small>{p.label}</small>
          </button>
        ))}
      </div>
      {texts.length > 0 && (
        <>
          <div className="lib-title">Chữ trong brand kit</div>
          <div className="lib-list">
            {texts.map((t) => (
              <button
                key={t.id}
                className="lib-row"
                draggable
                onDragStart={drag({ kind: 'text', id: 'title', content: t.value })}
                onClick={() => addGraphicFromDrag({ kind: 'text', id: 'title', content: t.value })}
                title={t.value}
              >
                <Icon name="text" size={12} /> <b>{t.name}</b> <span className="muted">{t.value}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="lib-title">Hình khối</div>
      <div className="lib-grid shapes">
        {SHAPE_PRESETS.map((p) => (
          <button key={p.id} className="lib-card" draggable onDragStart={drag({ kind: 'shape', id: p.id, color: colors[0] })} onClick={() => addGraphicFromDrag({ kind: 'shape', id: p.id, color: colors[0] })}>
            <span className={'shape-ico s-' + p.id} style={{ ['--c' as string]: colors[0] ?? '#FF2D55' }} />
            <small>{p.label}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

function GraphicInspector({ clipId, g, len }: { clipId: string; g: GraphicData; len: number }) {
  const elements = useStore((s) => s.project.elements)
  const colors = elements.filter((e) => e.kind === 'color').map((e) => e.value)
  const brandFonts = elements.filter((e) => e.kind === 'font')
  const st = useStore.getState
  const layer = g.layer as unknown as Layer
  const begin = () => st().beginTrim()
  const setLayer = (fn: (l: Layer) => Layer, history = true) =>
    st().updateGraphic(clipId, (gg) => ({ ...gg, layer: fn(gg.layer as unknown as Layer) as unknown as Record<string, unknown> }), history)
  const setG = (patch: Partial<GraphicData>) => st().updateGraphic(clipId, (gg) => ({ ...gg, ...patch }))
  const tr = (k: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', v: number, history = true) =>
    setLayer((l) => ({ ...l, transform: { ...l.transform, [k]: { v } } }), history)

  return (
    <div className="panel-body graphic-insp">
      <div className="gi-head">
        <Icon name={layer.type === 'text' ? 'text' : 'shape'} size={13} />
        <b>{graphicLabel(g)}</b>
        <div className="spacer" />
        <button className="btn small" onClick={() => st().select(null)} title="Về thư viện chữ">
          <Icon name="plus" size={12} /> Thêm
        </button>
      </div>
      {layer.type === 'text' && <TextFields l={layer} set={(fn, h) => setLayer((x) => (x.type === 'text' ? { ...x, text: fn(x.text) } : x), h)} begin={begin} colors={colors} brandFonts={brandFonts} />}
      {layer.type === 'shape' && <ShapeFields l={layer} set={(fn, h) => setLayer((x) => (x.type === 'shape' ? { ...x, shape: fn(x.shape) } : x), h)} begin={begin} colors={colors} />}

      <Section title="Vị trí & kích thước">
        <div className="field-row">
          <label>X / Y</label>
          <NumberField value={layer.transform.x.v} suffix="px" onStart={begin} onChange={(v, live) => tr('x', v, !live)} width={64} />
          <NumberField value={layer.transform.y.v} suffix="px" onStart={begin} onChange={(v, live) => tr('y', v, !live)} width={64} />
        </div>
        <div className="field-row">
          <label>Tỉ lệ / Xoay</label>
          <NumberField value={layer.transform.scale.v} min={1} suffix="%" onStart={begin} onChange={(v, live) => tr('scale', v, !live)} width={64} />
          <NumberField value={layer.transform.rotation.v} suffix="°" onStart={begin} onChange={(v, live) => tr('rotation', v, !live)} width={64} />
        </div>
        <div className="field-row">
          <label>Độ mờ</label>
          <NumberField value={layer.transform.opacity.v} min={0} max={100} suffix="%" onStart={begin} onChange={(v, live) => tr('opacity', v, !live)} width={64} />
        </div>
        <div className="field-row">
          <label>Thời lượng</label>
          <NumberField
            value={len}
            min={0.2}
            suffix="s"
            precision={2}
            step={0.05}
            onStart={begin}
            onChange={(v) => {
              const tc = findTrackClip(st().project, clipId)
              if (tc) st().trimTrack(clipId, 'out', tc.clip.in + v)
            }}
            width={64}
          />
        </div>
      </Section>

      <Section title="Chuyển động">
        {layer.type === 'text' && (
          <>
            <div className="field-row">
              <label>Chữ vào</label>
              <select
                value={layer.text.animIn?.preset ?? 'none'}
                onChange={(e) => setLayer((x) => (x.type === 'text' ? { ...x, text: { ...x.text, animIn: e.target.value === 'none' ? null : defaultAnimator(e.target.value as TextPreset) } } : x))}
              >
                {TEXT_ANIMS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label>Chữ ra</label>
              <select
                value={layer.text.animOut?.preset ?? 'none'}
                onChange={(e) => setLayer((x) => (x.type === 'text' ? { ...x, text: { ...x.text, animOut: e.target.value === 'none' ? null : defaultAnimator(e.target.value as TextPreset) } } : x))}
              >
                {TEXT_ANIMS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="field-row">
          <label>Khối vào</label>
          <select value={g.motionIn ?? ''} onChange={(e) => setG({ motionIn: e.target.value || null })}>
            <option value="">Không</option>
            {MOTION_IN.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label>Khối ra</label>
          <select value={g.motionOut ?? ''} onChange={(e) => setG({ motionOut: e.target.value || null })}>
            <option value="">Không</option>
            {MOTION_OUT.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </Section>
    </div>
  )
}

function TextFields(props: {
  l: TextLayer
  set: (fn: (t: TextData) => TextData, history?: boolean) => void
  begin: () => void
  colors: string[]
  brandFonts: { name: string; value: string }[]
}) {
  const { l, set, begin, colors, brandFonts } = props
  const d = l.text
  const wrap = d.maxWidth > 0
  return (
    <>
      <Section title="Nội dung">
        <textarea
          className="text-content"
          rows={4}
          value={d.content}
          onFocus={begin}
          onChange={(e) => set((t) => ({ ...t, content: e.target.value }), false)}
          placeholder="Gõ chữ. Enter để sang đoạn mới."
        />
      </Section>
      <Section title="Kiểu chữ">
        <div className="field-row">
          <label>Font</label>
          <FontPicker
            value={d.font}
            brand={brandFonts.map((f) => ({ name: f.name, family: f.value }))}
            previewFamily={brandFonts.find((f) => f.name === d.font)?.value}
            onChange={(v) => set((t) => ({ ...t, font: v }))}
          />
        </div>
        <div className="field-row">
          <label>Cỡ / Đậm</label>
          <NumberField value={d.size} min={4} suffix="px" onStart={begin} onChange={(v) => set((t) => ({ ...t, size: v }), false)} width={60} />
          <select value={d.weight} onChange={(e) => set((t) => ({ ...t, weight: +e.target.value }))}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {{ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy', 900: 'Black' }[w]}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label>Màu</label>
          <ColorField value={d.color} swatches={colors} onChange={(c) => set((t) => ({ ...t, color: c ?? '#FFFFFF' }))} />
        </div>
        <div className="field-row">
          <label>Kiểu</label>
          <button className={'tbtn toggle' + (d.italic ? ' on' : '')} title="Nghiêng" onClick={() => set((t) => ({ ...t, italic: !t.italic }))}>
            <i>I</i>
          </button>
          <button className={'tbtn toggle' + (d.uppercase ? ' on' : '')} title="VIẾT HOA" onClick={() => set((t) => ({ ...t, uppercase: !t.uppercase }))}>
            AA
          </button>
        </div>
      </Section>
      <Section title="Đoạn văn">
        <div className="field-row">
          <label>Căn lề</label>
          <Segmented
            value={d.align}
            onChange={(v) => set((t) => ({ ...t, align: v, maxWidth: v === 'justify' && !t.maxWidth ? 600 : t.maxWidth }))}
            options={[
              { value: 'left', label: <Icon name="alignLeft" size={13} />, title: 'Căn trái' },
              { value: 'center', label: <Icon name="alignCenter" size={13} />, title: 'Căn giữa' },
              { value: 'right', label: <Icon name="alignRight" size={13} />, title: 'Căn phải' },
              { value: 'justify', label: <Icon name="alignJustify" size={13} />, title: 'Căn đều 2 bên' }
            ]}
          />
        </div>
        <div className="field-row">
          <label>Khung chữ</label>
          <label className="inline">
            <input type="checkbox" checked={wrap} onChange={(e) => set((t) => ({ ...t, maxWidth: e.target.checked ? Math.max(200, Math.round(t.size * 12)) : 0 }))} /> Tự xuống dòng
          </label>
          {wrap && <NumberField value={d.maxWidth} min={40} suffix="px" onStart={begin} onChange={(v) => set((t) => ({ ...t, maxWidth: v }), false)} width={64} />}
        </div>
        <div className="field-row">
          <label>Giãn dòng</label>
          <NumberField value={d.lineHeight} min={0.6} max={4} step={0.01} precision={2} suffix="×" onStart={begin} onChange={(v) => set((t) => ({ ...t, lineHeight: v }), false)} width={64} />
        </div>
        <div className="field-row">
          <label>Giãn chữ</label>
          <NumberField value={d.tracking.v} min={-50} max={400} step={0.5} suffix="px" onStart={begin} onChange={(v) => set((t) => ({ ...t, tracking: { v } }), false)} width={64} />
        </div>
        <div className="field-row">
          <label>Cách đoạn</label>
          <NumberField value={d.paraSpacing ?? 0} min={0} max={5} step={0.05} precision={2} suffix="×" onStart={begin} onChange={(v) => set((t) => ({ ...t, paraSpacing: v }), false)} width={64} />
        </div>
        <div className="field-row">
          <label>Thụt đầu dòng</label>
          <NumberField value={d.indent ?? 0} min={0} max={1000} suffix="px" onStart={begin} onChange={(v) => set((t) => ({ ...t, indent: v }), false)} width={64} />
        </div>
      </Section>
      <Section title="Viền, bóng, nền">
        <div className="field-row">
          <label className="inline">
            <input type="checkbox" checked={!!d.stroke} onChange={(e) => set((t) => ({ ...t, stroke: e.target.checked ? { color: '#000000', width: Math.max(2, Math.round(t.size * 0.06)) } : null }))} /> Viền
          </label>
          {d.stroke && (
            <>
              <ColorField value={d.stroke.color} swatches={colors} onChange={(c) => set((t) => ({ ...t, stroke: { ...t.stroke!, color: c ?? '#000000' } }))} />
              <NumberField value={d.stroke.width} min={0} suffix="px" onStart={begin} onChange={(v) => set((t) => ({ ...t, stroke: { ...t.stroke!, width: v } }), false)} width={52} />
            </>
          )}
        </div>
        <div className="field-row">
          <label className="inline">
            <input type="checkbox" checked={!!d.shadow} onChange={(e) => set((t) => ({ ...t, shadow: e.target.checked ? { color: 'rgba(0,0,0,0.6)', blur: Math.round(t.size * 0.2), x: 0, y: Math.round(t.size * 0.06) } : null }))} /> Đổ bóng
          </label>
          {d.shadow && (
            <>
              <ColorField value={d.shadow.color} swatches={colors} onChange={(c) => set((t) => ({ ...t, shadow: { ...t.shadow!, color: c ?? '#000000' } }))} />
              <NumberField value={d.shadow.blur} min={0} suffix="blur" onStart={begin} onChange={(v) => set((t) => ({ ...t, shadow: { ...t.shadow!, blur: v } }), false)} width={60} />
            </>
          )}
        </div>
        <div className="field-row">
          <label className="inline">
            <input type="checkbox" checked={!!d.box} onChange={(e) => set((t) => ({ ...t, box: e.target.checked ? { color: '#000000', opacity: 0.6, padding: Math.round(t.size * 0.35), radius: Math.round(t.size * 0.2) } : null }))} /> Nền chữ
          </label>
          {d.box && <ColorField value={d.box.color} swatches={colors} onChange={(c) => set((t) => ({ ...t, box: { ...t.box!, color: c ?? '#000000' } }))} />}
        </div>
        {d.box && (
          <div className="field-row">
            <label>Mờ / Lề / Bo</label>
            <NumberField value={Math.round(d.box.opacity * 100)} min={0} max={100} suffix="%" onStart={begin} onChange={(v) => set((t) => ({ ...t, box: { ...t.box!, opacity: v / 100 } }), false)} width={52} />
            <NumberField value={d.box.padding} min={0} suffix="px" onStart={begin} onChange={(v) => set((t) => ({ ...t, box: { ...t.box!, padding: v } }), false)} width={52} />
            <NumberField value={d.box.radius} min={0} suffix="px" onStart={begin} onChange={(v) => set((t) => ({ ...t, box: { ...t.box!, radius: v } }), false)} width={52} />
          </div>
        )}
      </Section>
    </>
  )
}

function ShapeFields(props: { l: ShapeLayer; set: (fn: (s: ShapeLayer['shape']) => ShapeLayer['shape'], history?: boolean) => void; begin: () => void; colors: string[] }) {
  const { l, set, begin, colors } = props
  const s = l.shape
  return (
    <Section title="Hình">
      <div className="field-row">
        <label>Loại</label>
        <Segmented
          value={s.kind}
          onChange={(v) => set((x) => ({ ...x, kind: v }))}
          options={[
            { value: 'rect', label: 'Chữ nhật' },
            { value: 'ellipse', label: 'Tròn' },
            { value: 'line', label: 'Đường' }
          ]}
        />
      </div>
      <div className="field-row">
        <label>Rộng / Cao</label>
        <NumberField value={s.width.v} min={1} suffix="px" onStart={begin} onChange={(v) => set((x) => ({ ...x, width: { v } }), false)} width={60} />
        <NumberField value={s.height.v} min={0} suffix="px" onStart={begin} onChange={(v) => set((x) => ({ ...x, height: { v } }), false)} width={60} />
      </div>
      {s.kind === 'rect' && (
        <div className="field-row">
          <label>Bo góc</label>
          <NumberField value={s.radius} min={0} suffix="px" onStart={begin} onChange={(v) => set((x) => ({ ...x, radius: v }), false)} width={60} />
        </div>
      )}
      <div className="field-row">
        <label>Màu nền</label>
        <ColorField value={s.fill} allowNone swatches={colors} onChange={(c) => set((x) => ({ ...x, fill: c }))} />
      </div>
      <div className="field-row">
        <label>Viền</label>
        <ColorField value={s.stroke} allowNone swatches={colors} onChange={(c) => set((x) => ({ ...x, stroke: c }))} />
        <NumberField value={s.strokeWidth} min={0} suffix="px" onStart={begin} onChange={(v) => set((x) => ({ ...x, strokeWidth: v }), false)} width={52} />
      </div>
    </Section>
  )
}
