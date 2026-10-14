// Trạng thái giao diện dùng chung giữa các khung (tab bên trái…)
import { create } from 'zustand'

export type LeftTab = 'elements' | 'media' | 'text' | 'sound'

export const useUi = create<{ leftTab: LeftTab; setLeftTab: (t: LeftTab) => void }>((set) => ({
  leftTab: 'elements',
  setLeftTab: (leftTab) => set({ leftTab })
}))
