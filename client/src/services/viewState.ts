import { CanvasTransform, ToolType } from '../types';

export interface BoardViewState {
  transform: CanvasTransform;
  tool: ToolType;
  savedAt: string;
}

const STORAGE_KEY_PREFIX = 'whiteboard:view:';

const VALID_TOOLS: ToolType[] = [
  'select', 'pen', 'rect', 'circle', 'line', 'text', 'sticky-note', 'eraser'
];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidTransform = (value: unknown): value is CanvasTransform => {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  if (!isFiniteNumber(t.scale) || !isFiniteNumber(t.translateX) || !isFiniteNumber(t.translateY)) {
    return false;
  }
  // 与画布缩放边界保持一致，剔除异常值
  return t.scale > 0 && t.scale >= 0.1 && t.scale <= 5;
};

export type ViewStateResult =
  | { status: 'restored'; state: BoardViewState }
  | { status: 'missing' }
  | { status: 'corrupt' };

/**
 * 读取某画板上次保存的视图状态：
 * - missing：从未保存过，不显示恢复入口
 * - corrupt：数据损坏（无法解析/字段缺失/数值非法），清除记录并由调用方说明原因
 * - restored：校验通过，返回可用的视图状态
 */
export const loadViewState = (boardId: string): ViewStateResult => {
  const raw = localStorage.getItem(STORAGE_KEY_PREFIX + boardId);
  if (raw === null) return { status: 'missing' };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!isValidTransform(parsed.transform)) {
      throw new Error('invalid transform');
    }
    if (typeof parsed.tool !== 'string' || !VALID_TOOLS.includes(parsed.tool as ToolType)) {
      throw new Error('invalid tool');
    }
    if (typeof parsed.savedAt !== 'string' || Number.isNaN(Date.parse(parsed.savedAt))) {
      throw new Error('invalid savedAt');
    }
    return {
      status: 'restored',
      state: {
        transform: parsed.transform as CanvasTransform,
        tool: parsed.tool as ToolType,
        savedAt: parsed.savedAt,
      },
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY_PREFIX + boardId);
    return { status: 'corrupt' };
  }
};

export const saveViewState = (
  boardId: string,
  transform: CanvasTransform,
  tool: ToolType
): void => {
  try {
    const state: BoardViewState = {
      transform: {
        scale: transform.scale,
        translateX: transform.translateX,
        translateY: transform.translateY,
      },
      tool,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_PREFIX + boardId, JSON.stringify(state));
  } catch {
    // 存储空间已满或被禁用时忽略，不影响正常使用
  }
};

export const clearViewState = (boardId: string): void => {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + boardId);
  } catch {
    // ignore
  }
};
