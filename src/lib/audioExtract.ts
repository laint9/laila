// Tách âm thanh từ video (kiểu "Trích xuất âm thanh" của CapCut)
import type { MediaItem } from '../../shared/types'
import { findTrackClip, useStore } from './store'

/** File âm thanh tách từ 1 media video; tách rồi thì dùng lại */
export async function extractAudioOf(mediaId: string): Promise<MediaItem> {
  const st = useStore.getState()
  const done = st.project.media.find((m) => m.kind === 'audio' && m.from === mediaId)
  if (done) return done
  const src = st.project.media.find((m) => m.id === mediaId)
  if (!src) throw new Error('Không thấy video')
  if (!src.hasAudio) throw new Error('Video này không có tiếng')
  const item = { ...(await window.laila.media.extractAudio(src.path)), from: mediaId }
  useStore.getState().addMedia([item])
  return item
}

/** Clip đang chọn có tiếng để tách không */
export function canDetach(clipId: string | null): boolean {
  if (!clipId) return false
  const p = useStore.getState().project
  const c = p.timeline.find((x) => x.id === clipId) ?? findTrackClip(p, clipId)?.clip
  if (!c || ('graphic' in c && c.graphic)) return false
  const m = p.media.find((x) => x.id === c.mediaId)
  return !!m && m.kind !== 'audio' && m.kind !== 'image' && m.hasAudio
}

/** Tách tiếng của clip trên timeline ra track âm thanh, đúng vị trí, clip gốc tắt tiếng */
export async function detachClipAudio(clipId: string): Promise<MediaItem> {
  const p = useStore.getState().project
  const c = p.timeline.find((x) => x.id === clipId) ?? findTrackClip(p, clipId)?.clip
  if (!c) throw new Error('Chưa chọn clip')
  const audio = await extractAudioOf(c.mediaId)
  useStore.getState().detachAudio(clipId, audio)
  return audio
}
