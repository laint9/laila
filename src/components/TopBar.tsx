import { useStore, emptyProject } from '../lib/store'
import { totalDuration } from '../lib/timeline'
import { fmtTime } from '../lib/media'
import { Icon } from './Icon'

export function TopBar(props: { onSettings: () => void; onExport: () => void; apiReady: boolean }) {
  const project = useStore((s) => s.project)
  const rename = useStore((s) => s.rename)
  const setProject = useStore((s) => s.setProject)
  const total = totalDuration(project.timeline)

  const open = async () => {
    const p = await window.laila.project.open()
    if (p) setProject(p)
  }
  const newProject = () => {
    if (confirm('Tạo project mới? Nhớ bấm Lưu nếu muốn giữ project hiện tại thành file.')) setProject(emptyProject())
  }

  return (
    <header className="topbar">
      <div className="app-mark">
        <span className="logo-dot" />
        Laila
      </div>
      <input className="project-name" value={project.name} onChange={(e) => rename(e.target.value)} title="Đổi tên project" />
      <span className="meta">
        {project.settings.width}×{project.settings.height} · {project.settings.fps} fps · {fmtTime(total)}
      </span>
      <div className="spacer drag" />
      <div className="btn-group">
        <button className="btn" onClick={newProject} title="Project mới">
          <Icon name="doc" /> Mới
        </button>
        <button className="btn" onClick={open} title="Mở project">
          <Icon name="folder" /> Mở
        </button>
        <button className="btn" onClick={() => window.laila.project.saveAs(project)} title="Lưu project ra file">
          Lưu
        </button>
      </div>
      <button className="btn" onClick={props.onSettings} title="Cài đặt">
        <span className={'status-dot ' + (props.apiReady ? 'ok' : 'bad')} />
        <Icon name="gear" />
      </button>
      <button className="btn primary" disabled={project.timeline.length === 0} onClick={props.onExport}>
        <Icon name="share" /> Xuất video
      </button>
    </header>
  )
}
