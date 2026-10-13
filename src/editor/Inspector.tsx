// Panel Properties (kiểu Properties panel của AE 2024): mọi thuộc tính của layer đang chọn.
import { useEffect, useRef } from 'react'
import { valueAt } from '../engine/ease'
import { defaultAnimator } from '../engine/normalize'
import { layerCorners, parentSpace } from '../engine/render'
import type { BlendMode, Ease, EaseName, Layer, TextAnimator, TextLayer, TextPreset } from '../engine/types'
import { EASE_LABELS } from '../engine/ease'
import { Icon } from '../components/Icon'
import { MAC_FONTS, useEditorCtx } from './context'
import { EaseEditor } from './EaseEditor'
import { ColorField, NumberField, PropRow, Section, Segmented } from './fields'
import { selectedLayer, useEditor } from './state'

const TEXT_PRESETS: { value: TextPreset; label: string }[] = [
  { value: 'mask', label: 'Mask (trồi lên từ vạch)' },
  { value: 'slideUp', label: 'Trượt lên' },
  { value: 'slideDown', label: 'Trượt xuống' },
  { value: 'slideLeft', label: 'Trượt từ phải' },
  { value: 'fade', label: 'Fade' },
  { value: 'blur', label: 'Blur' },
  { value: 'scale', label: 'Phóng to' },
  { value: 'rotate', label: 'Xoay' },
  { value: 'typewriter', label: 'Đánh máy' }
]

export function Inspector() {
  const layer = useEditor(selectedLayer)
  const keys = useEditor((s) => s.keys)
  return (
    <div className="inspector">
      {keys.length > 0 && <EaseEditor />}
      {layer ? <LayerInspector key={layer.id} layer={layer} /> : <SceneInspector />}
    </div>
  )
}

function SceneInspector() {
  const scene = useEditor((s) => s.scene)
  const duration = useEditor((s) => s.duration)
  const ed = useEditor.getState
  const { elements } = useEditorCtx()
  const colors = elements.filter((e) => e.kind === 'color').map((e) => e.value)
  return (
    <>
      <Section title="Composition">
        <div className="field-row">
          <label>Thời lượng</label>
          <NumberField value={duration} step={0.1} min={0.5} max={60} suffix="s" precision={2} onChange={(v) => ed().setDuration(v)} />
        </div>
        <div className="field-row">
          <label>Nền</label>
          <ColorField value={scene.background} allowNone swatches={colors} onChange={(c) => ed().edit((s) => ({ ...s, background: c }))} />
        </div>
      </Section>
      <div className="empty-insp">
        <Icon name="pointer" size={22} />
        <p>Chọn một layer trong khung hình hoặc trong danh sách layer để chỉnh.</p>
        <p className="muted small">Phím tắt: V chọn · T chữ · Q hình · Space phát · J/K keyframe trước/sau · F9 Easy Ease · U hiện thuộc tính có keyframe</p>
      </div>
    </>
  )
}

function LayerInspector({ layer }: { layer: Layer }) {
  const scene = useEditor((s) => s.scene)
  const time = useEditor((s) => s.time)
  const ed = useEditor.getState
  const { runner, elements } = useEditorCtx()
  const set = (fn: (l: Layer) => Layer, history = true) => ed().editLayer(layer.id, fn, { history })
  const colors = elements.filter((e) => e.kind === 'color').map((e) => e.value)

  // đổi điểm neo nhưng giữ nguyên vị trí hiển thị (như Pan Behind trong AE)
  const setAnchor = (ax: number, ay: number) => {
    const assets = runner.assets
    if (!assets) return set((l) => ({ ...l, anchor: [ax, ay] }))
    const ctx = new OffscreenCanvas(8, 8).getContext('2d')!
    const before = layerCorners(ctx, scene, layer, time, assets)
    const target = before.m.transformPoint(new DOMPoint(ax * before.w, ay * before.h))
    const inv = parentSpace(scene, layer, time).inverse()
    const a = inv.transformPoint(before.anchor)
    const b = inv.transformPoint(target)
    const dx = b.x - a.x,
      dy = b.y - a.y
    const shift = (p: Layer['transform']['x'], d: number) => ({ ...p, v: p.v + d, keys: p.keys?.map((k) => ({ ...k, v: k.v + d })) })
    set((l) => ({ ...l, anchor: [ax, ay], transform: { ...l.transform, x: shift(l.transform.x, dx), y: shift(l.transform.y, dy) } }))
  }

  return (
    <>
      <Section title="Layer">
        <div className="field-row">
          <label>Tên</label>
          <input value={layer.name} onChange={(e) => set((l) => ({ ...l, name: e.target.value }), false)} />
        </div>
        <div className="field-row">
          <label>Thời gian</label>
          <NumberField value={layer.in} step={0.05} min={0} max={layer.out - 0.04} suffix="s" precision={2} width={54} onStart={() => ed().checkpoint()} onChange={(v) => set((l) => ({ ...l, in: v }), false)} />
          <span className="muted">→</span>
          <NumberField value={layer.out} step={0.05} min={layer.in + 0.04} max={600} suffix="s" precision={2} width={54} onStart={() => ed().checkpoint()} onChange={(v) => set((l) => ({ ...l, out: v }), false)} />
        </div>
        <div className="field-row">
          <label>Parent</label>
          <select value={layer.parent ?? ''} onChange={(e) => set((l) => ({ ...l, parent: e.target.value || null }))}>
            <option value="">Không</option>
            {scene.layers
              .filter((l) => l.id !== layer.id && !isDescendant(scene.layers, l.id, layer.id))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field-row">
          <label>Hoà trộn</label>
          <select value={layer.blend} onChange={(e) => set((l) => ({ ...l, blend: e.target.value as BlendMode }))}>
            <option value="normal">Normal</option>
            <option value="multiply">Multiply</option>
            <option value="screen">Screen</option>
            <option value="add">Add</option>
            <option value="overlay">Overlay</option>
          </select>
        </div>
      </Section>

      <Section title="Transform">
        {layer.type !== 'code' && (
          <div className="field-row">
            <label>Điểm neo</label>
            <div className="anchor-grid">
              {[0, 0.5, 1].map((ay) =>
                [0, 0.5, 1].map((ax) => (
                  <button
                    key={`${ax}-${ay}`}
                    className={layer.anchor[0] === ax && layer.anchor[1] === ay ? 'on' : ''}
                    title="Đặt điểm neo (giữ nguyên vị trí)"
                    onClick={() => setAnchor(ax, ay)}
                  />
                ))
              )}
            </div>
          </div>
        )}
        <PropRow layer={layer} path="transform.x" label="Vị trí X" suffix="px" />
        <PropRow layer={layer} path="transform.y" label="Vị trí Y" suffix="px" />
        <PropRow layer={layer} path="transform.scale" label="Tỉ lệ" suffix="%" step={0.5} />
        <PropRow layer={layer} path="transform.rotation" label="Xoay" suffix="°" step={0.5} />
        <PropRow layer={layer} path="transform.opacity" label="Độ mờ" suffix="%" min={0} max={100} step={0.5} />
        <PropRow layer={layer} path="transform.blur" label="Blur" suffix="px" min={0} max={500} step={0.2} />
      </Section>

      {layer.type === 'text' && <TextSection layer={layer} colors={colors} />}

      {layer.type === 'shape' && (
        <Section title="Hình">
          <div className="field-row">
            <label>Loại</label>
            <Segmented
              value={layer.shape.kind}
              options={[
                { value: 'rect', label: <Icon name="rect" size={14} />, title: 'Chữ nhật' },
                { value: 'ellipse', label: <Icon name="ellipse" size={14} />, title: 'Elip' },
                { value: 'line', label: <Icon name="line" size={14} />, title: 'Đường' }
              ]}
              onChange={(k) => set((l) => (l.type === 'shape' ? { ...l, shape: { ...l.shape, kind: k, stroke: k === 'line' ? l.shape.stroke ?? l.shape.fill ?? '#FFFFFF' : l.shape.stroke, strokeWidth: k === 'line' && !l.shape.strokeWidth ? 6 : l.shape.strokeWidth } } : l))}
            />
          </div>
          <PropRow layer={layer} path="shape.width" label="Rộng" suffix="px" min={0} />
          {layer.shape.kind !== 'line' && <PropRow layer={layer} path="shape.height" label="Cao" suffix="px" min={0} />}
          {layer.shape.kind === 'rect' && (
            <div className="field-row">
              <label>Bo góc</label>
              <NumberField value={layer.shape.radius} min={0} suffix="px" onStart={() => ed().checkpoint()} onChange={(v) => set((l) => (l.type === 'shape' ? { ...l, shape: { ...l.shape, radius: v } } : l), false)} />
            </div>
          )}
          {layer.shape.kind !== 'line' && (
            <div className="field-row">
              <label>Màu nền</label>
              <ColorField value={layer.shape.fill} allowNone swatches={colors} onChange={(c) => set((l) => (l.type === 'shape' ? { ...l, shape: { ...l.shape, fill: c } } : l))} />
            </div>
          )}
          <div className="field-row">
            <label>Viền</label>
            <ColorField value={layer.shape.stroke} allowNone swatches={colors} onChange={(c) => set((l) => (l.type === 'shape' ? { ...l, shape: { ...l.shape, stroke: c } } : l))} />
          </div>
          <div className="field-row">
            <label>Độ dày viền</label>
            <NumberField value={layer.shape.strokeWidth} min={0} suffix="px" step={0.5} onStart={() => ed().checkpoint()} onChange={(v) => set((l) => (l.type === 'shape' ? { ...l, shape: { ...l.shape, strokeWidth: v } } : l), false)} />
          </div>
          <PropRow layer={layer} path="shape.trimEnd" label="Trim Paths" suffix="%" min={0} max={100} />
        </Section>
      )}

      {layer.type === 'image' && (
        <Section title="Ảnh">
          <div className="field-row">
            <label>Ảnh</label>
            <select value={layer.image.src} onChange={(e) => set((l) => (l.type === 'image' ? { ...l, image: { ...l.image, src: e.target.value } } : l))}>
              {!elements.some((e) => e.kind === 'image' && e.name === layer.image.src) && <option value={layer.image.src}>{layer.image.src || '—'}</option>}
              {elements
                .filter((e) => e.kind === 'image')
                .map((e) => (
                  <option key={e.id} value={e.name}>
                    {e.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field-row">
            <label>Rộng</label>
            <NumberField value={layer.image.width} min={1} suffix="px" onStart={() => ed().checkpoint()} onChange={(v) => set((l) => (l.type === 'image' ? { ...l, image: { ...l.image, width: v } } : l), false)} />
          </div>
        </Section>
      )}

      {layer.type === 'code' && (
        <Section title="Code (nâng cao)">
          <p className="hint">Layer vẽ bằng code: render(ctx, t, api). Dùng cho hạt, nền động… Thường nhờ Claude sửa sẽ nhanh hơn.</p>
          <textarea
            className="code"
            rows={14}
            spellCheck={false}
            value={layer.code.source}
            onChange={(e) => set((l) => (l.type === 'code' ? { ...l, code: { source: e.target.value } } : l), false)}
            onFocus={() => ed().checkpoint()}
          />
          {runner.errors().filter((x) => x.layerId === layer.id).map((x) => (
            <pre key={x.layerId} className="error">
              {x.message}
            </pre>
          ))}
        </Section>
      )}
    </>
  )
}

function isDescendant(layers: Layer[], id: string, ancestor: string): boolean {
  let cur = layers.find((l) => l.id === id)
  for (let i = 0; cur && i < 50; i++) {
    if (cur.parent === ancestor) return true
    cur = layers.find((l) => l.id === cur!.parent)
  }
  return false
}

function TextSection({ layer, colors }: { layer: TextLayer; colors: string[] }) {
  const ed = useEditor.getState
  const { elements } = useEditorCtx()
  const area = useRef<HTMLTextAreaElement>(null)
  const set = (fn: (d: TextLayer['text']) => Partial<TextLayer['text']>, history = true) =>
    ed().editLayer(layer.id, (l) => (l.type === 'text' ? { ...l, text: { ...l.text, ...fn(l.text) } } : l), { history })
  const d = layer.text
  const brandFonts = elements.filter((e) => e.kind === 'font')

  useEffect(() => {
    const focus = () => {
      area.current?.focus()
      area.current?.select()
    }
    window.addEventListener('laila:focus-text', focus)
    return () => window.removeEventListener('laila:focus-text', focus)
  }, [])

  return (
    <>
      <Section title="Chữ (Character)">
        <textarea
          ref={area}
          className="text-content"
          rows={3}
          value={d.content}
          onFocus={() => ed().checkpoint()}
          onChange={(e) => set(() => ({ content: e.target.value }), false)}
        />
        <div className="field-row">
          <label>Font</label>
          <input
            list="laila-fonts"
            value={d.font}
            placeholder="Font hệ thống"
            style={{ fontFamily: brandFonts.find((f) => f.name === d.font)?.value ?? d.font }}
            onChange={(e) => set(() => ({ font: e.target.value }), false)}
          />
          <datalist id="laila-fonts">
            {brandFonts.map((f) => (
              <option key={f.id} value={f.name}>
                {f.value} (brand)
              </option>
            ))}
            {MAC_FONTS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <div className="field-row">
          <label>Cỡ / Đậm</label>
          <NumberField value={d.size} min={1} suffix="px" onStart={() => ed().checkpoint()} onChange={(v) => set(() => ({ size: v }), false)} width={60} />
          <select value={d.weight} onChange={(e) => set(() => ({ weight: +e.target.value }))}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {{ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy', 900: 'Black' }[w]}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label>Màu</label>
          <ColorField value={d.color} swatches={colors} onChange={(c) => set(() => ({ color: c ?? '#FFFFFF' }))} />
        </div>
        <div className="field-row">
          <label>Căn lề</label>
          <Segmented
            value={d.align}
            options={[
              { value: 'left', label: <Icon name="alignL" size={14} />, title: 'Trái' },
              { value: 'center', label: <Icon name="alignCH" size={14} />, title: 'Giữa' },
              { value: 'right', label: <Icon name="alignR" size={14} />, title: 'Phải' }
            ]}
            onChange={(a) => set(() => ({ align: a }))}
          />
        </div>
        <div className="field-row">
          <label>Giãn dòng</label>
          <NumberField value={d.lineHeight} step={0.01} precision={2} min={0.5} max={4} onStart={() => ed().checkpoint()} onChange={(v) => set(() => ({ lineHeight: v }), false)} />
        </div>
        <div className="field-row">
          <label>Khung rộng</label>
          <NumberField value={d.maxWidth} min={0} suffix="px" onStart={() => ed().checkpoint()} onChange={(v) => set(() => ({ maxWidth: v }), false)} />
          <span className="muted small">0 = không xuống dòng</span>
        </div>
        <PropRow layer={layer} path="text.tracking" label="Giãn chữ" suffix="px" step={0.2} />
      </Section>

      <AnimatorSection title="Text Animator · Vào" value={d.animIn} onChange={(a, h) => set(() => ({ animIn: a }), h)} layerLen={layer.out - layer.in} />
      <AnimatorSection title="Text Animator · Ra" value={d.animOut} onChange={(a, h) => set(() => ({ animOut: a }), h)} layerLen={layer.out - layer.in} />
    </>
  )
}

function AnimatorSection(props: { title: string; value: TextAnimator | null; onChange: (a: TextAnimator | null, history: boolean) => void; layerLen: number }) {
  const a = props.value
  const ed = useEditor.getState
  const patch = (p: Partial<TextAnimator>, history = true) => a && props.onChange({ ...a, ...p }, history)
  return (
    <Section
      title={props.title}
      right={
        <select
          className="small-select"
          value={a?.preset ?? ''}
          onChange={(e) => {
            const v = e.target.value as TextPreset
            if (!v) return props.onChange(null, true)
            const base = defaultAnimator(v)
            props.onChange(a ? { ...a, preset: v, unit: base.unit } : base, true)
          }}
        >
          <option value="">Không</option>
          {TEXT_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      }
    >
      {a ? (
        <>
          <div className="field-row">
            <label>Theo</label>
            <Segmented
              value={a.unit}
              options={[
                { value: 'char', label: 'Ký tự' },
                { value: 'word', label: 'Từ' },
                { value: 'line', label: 'Dòng' }
              ]}
              onChange={(u) => patch({ unit: u })}
            />
          </div>
          <div className="field-row">
            <label>Thứ tự</label>
            <select value={a.order} onChange={(e) => patch({ order: e.target.value as TextAnimator['order'] })}>
              <option value="forward">Từ đầu</option>
              <option value="reverse">Từ cuối</option>
              <option value="center">Từ giữa ra</option>
              <option value="random">Ngẫu nhiên</option>
            </select>
          </div>
          <div className="field-row">
            <label>Mỗi phần</label>
            <NumberField value={a.duration} step={0.01} precision={2} min={0.01} max={10} suffix="s" onStart={() => ed().checkpoint()} onChange={(v) => patch({ duration: v }, false)} width={54} />
            <label className="inline">Cách nhau</label>
            <NumberField value={a.stagger} step={0.005} precision={3} min={0} max={5} suffix="s" onStart={() => ed().checkpoint()} onChange={(v) => patch({ stagger: v }, false)} width={54} />
          </div>
          <div className="field-row">
            <label>Trễ</label>
            <NumberField value={a.delay} step={0.01} precision={2} min={0} max={props.layerLen} suffix="s" onStart={() => ed().checkpoint()} onChange={(v) => patch({ delay: v }, false)} width={54} />
            <label className="inline">Quãng</label>
            <NumberField value={a.distance} step={0.01} precision={2} min={-10} max={10} suffix="×" onStart={() => ed().checkpoint()} onChange={(v) => patch({ distance: v }, false)} width={54} />
          </div>
          <div className="field-row">
            <label>Ease</label>
            <select value={Array.isArray(a.ease) ? 'custom' : a.ease} onChange={(e) => e.target.value !== 'custom' && patch({ ease: e.target.value as Ease })}>
              {Array.isArray(a.ease) && <option value="custom">Tuỳ chỉnh</option>}
              {(Object.keys(EASE_LABELS) as EaseName[]).filter((n) => n !== 'hold').map((n) => (
                <option key={n} value={n}>
                  {EASE_LABELS[n]}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <p className="hint">Chưa có. Chọn kiểu ở góc phải để chữ xuất hiện theo từng ký tự / từ / dòng.</p>
      )}
    </Section>
  )
}

