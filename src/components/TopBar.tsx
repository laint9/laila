import { useStore, emptyProject } from '../lib/store'
import { totalDuration } from '../lib/timeline'
import { fmtTime } from '../lib/media'

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
    if (confirm('Tạo project mới? Project hiện tại vẫn được lưu nếu anh đã Save As.')) setProject(emptyProject())
  }

  return (
    <header className="topbar">
      <div className="brand">Laila</div>
      <input className="project-name" value={project.name} onChange={(e) => rename(e.target.value)} />
      <div className="meta">
        {project.settings.width}×{project.settings.height} · {project.settings.fps}fps · {fmtTime(total)}
      </div>
      <div className="spacer" />
      <button className="ghost" onClick={newProject}>Mới</button>
      <button className="ghost" onClick={open}>Mở</button>
      <button className="ghost" onClick={() => window.laila.project.saveAs(project)}>Lưu</button>
      <button className="ghost" onClick={props.onSettings}>
        <span className={'dot ' + (props.apiReady ? 'ok' : 'bad')} /> Settings
      </button>
      <button className="primary" disabled={project.timeline.length === 0} onClick={props.onExport}>
        Xuất video
      </button>
    </header>
  )
}
