import { useStore } from '../lib/store'
import { mediaUrl } from '../lib/media'
import type { BrandElement, ElementKind } from '../../shared/types'

const KIND_LABEL: Record<ElementKind, string> = {
  text: 'Text',
  color: 'Màu',
  image: 'Ảnh/Logo',
  font: 'Font',
  note: 'Ghi chú brand'
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
      <p className="hint">
        Input các element anh muốn Claude dùng. Claude gọi chúng theo <b>tên</b>, nên đặt tên ngắn gọn (vd: logo,
        headline, primary).
      </p>
      <div className="add-row">
        <button onClick={() => add('text')}>+ Text</button>
        <button onClick={() => add('color')}>+ Màu</button>
        <button onClick={addImage}>+ Ảnh</button>
        <button onClick={() => add('font')}>+ Font</button>
        <button onClick={() => add('note')}>+ Ghi chú</button>
      </div>
      <div className="elements">
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
        <span className={'kind kind-' + el.kind}>{KIND_LABEL[el.kind]}</span>
        <input className="el-name" value={el.name} onChange={(e) => update(el.id, { name: e.target.value })} />
        <button className="icon" title="Xoá" onClick={() => remove(el.id)}>
          ×
        </button>
      </div>
      {el.kind === 'color' && (
        <div className="color-row">
          <input type="color" value={el.value} onChange={(e) => update(el.id, { value: e.target.value })} />
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
        <input
          value={el.value}
          style={{ fontFamily: el.value }}
          placeholder="Tên font đã cài trên Mac, vd: Inter, Futura"
          onChange={(e) => update(el.id, { value: e.target.value })}
        />
      )}
    </div>
  )
}
