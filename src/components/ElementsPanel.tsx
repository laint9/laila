import { useStore } from '../lib/store'
import { mediaUrl } from '../lib/media'
import type { BrandElement, ElementKind } from '../../shared/types'
import { Icon } from './Icon'

const KIND: Record<ElementKind, { label: string; icon: string }> = {
  text: { label: 'Chữ', icon: 'text' },
  color: { label: 'Màu', icon: 'ellipse' },
  image: { label: 'Ảnh / Logo', icon: 'image' },
  font: { label: 'Font', icon: 'text' },
  note: { label: 'Ghi chú', icon: 'doc' }
}

export function ElementsPanel() {
  const elements = useStore((s) => s.project.elements)
  const add = useStore((s) => s.addElement)

  const addImage = async () => {
    const path = await window.laila.file.pickImage()
    if (path) add('image', path)
  }

  return (
    <div className="panel-body">
      <p className="hint">Claude dùng các element này theo <b>tên</b>. Đặt tên ngắn gọn: logo, headline, primary…</p>
      <div className="chip-buttons">
        <button className="btn small" onClick={() => add('text')}>
          <Icon name="plus" size={12} /> Chữ
        </button>
        <button className="btn small" onClick={() => add('color')}>
          <Icon name="plus" size={12} /> Màu
        </button>
        <button className="btn small" onClick={addImage}>
          <Icon name="plus" size={12} /> Ảnh
        </button>
        <button className="btn small" onClick={() => add('font')}>
          <Icon name="plus" size={12} /> Font
        </button>
        <button className="btn small" onClick={() => add('note')}>
          <Icon name="plus" size={12} /> Ghi chú
        </button>
      </div>
      <div className="list-group">
        {elements.map((e) => (
          <ElementRow key={e.id} el={e} />
        ))}
        {elements.length === 0 && <div className="empty">Chưa có element nào.</div>}
      </div>
    </div>
  )
}

function ElementRow({ el }: { el: BrandElement }) {
  const update = useStore((s) => s.updateElement)
  const remove = useStore((s) => s.removeElement)

  const replaceImage = async () => {
    const path = await window.laila.file.pickImage()
    if (path) update(el.id, { value: path })
  }

  return (
    <div className="element">
      <div className="element-head">
        <span className={'kind-badge k-' + el.kind}>
          {el.kind === 'color' ? <i className="dot" style={{ background: el.value }} /> : <Icon name={KIND[el.kind].icon} size={11} />}
          {KIND[el.kind].label}
        </span>
        <input className="el-name" value={el.name} onChange={(e) => update(el.id, { name: e.target.value })} title="Tên để Claude gọi" />
        <button className="tiny" title="Xoá" onClick={() => remove(el.id)}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      {el.kind === 'color' && (
        <div className="color-row">
          <label className="swatch-input" style={{ background: el.value }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(el.value) ? el.value : '#000000'} onChange={(e) => update(el.id, { value: e.target.value })} />
          </label>
          <input value={el.value} onChange={(e) => update(el.id, { value: e.target.value })} />
        </div>
      )}
      {el.kind === 'image' && (
        <div className="image-row" onClick={replaceImage} title="Bấm để đổi ảnh">
          {el.value ? <img src={mediaUrl(el.value)} alt={el.name} /> : <span>Chọn ảnh…</span>}
        </div>
      )}
      {(el.kind === 'text' || el.kind === 'note') && (
        <textarea rows={el.kind === 'note' ? 3 : 2} value={el.value} onChange={(e) => update(el.id, { value: e.target.value })} />
      )}
      {el.kind === 'font' && (
        <input value={el.value} style={{ fontFamily: el.value }} placeholder="Tên font đã cài trên Mac, vd: Inter, Futura" onChange={(e) => update(el.id, { value: e.target.value })} />
      )}
    </div>
  )
}
