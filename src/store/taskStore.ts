/**
 * 任务中心状态桥接（P2.1-M4）：app-context 装配时 tasks.subscribe 推入
 */

import { create } from 'zustand';
import type { TaskInfo } from '../services/task/types';

interface TaskStore {
  tasks: TaskInfo[];
  setTasks: (tasks: TaskInfo[]) => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks })
}));
