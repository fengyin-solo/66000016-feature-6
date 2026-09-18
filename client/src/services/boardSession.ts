import { CanvasTransform, ToolType } from '../types';

/**
 * 每个画板的本地浏览状态（缩放/平移/工具选择），
 * 用于离开画板后再次进入时恢复。
 */
export interface BoardSession {
  version: 1;
  boardId: string;
  transform: CanvasTransform;
  activeTool: ToolType;
  savedAt: number;
}

export type LoadSessionResult =
  | { status: 'ok'; session: BoardSession }
  | { status: 'none' }
  | { status: 'corrupted' };

const STORAGE_PREFIX = 'whiteboard-session:';

const VALID_TOOLS: ToolType[] = [
  'select', 'pen', 'rect', 'circle', 'line', 'text', 'sticky-note', 'eraser',
];

// 与 WhiteboardCanvas 滚轮缩放的取值范围保持一致
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidSession = (data: unknown, boardId: string): data is BoardSession => {
  if (!data || typeof data !== 'object') return false;
  const session = data as Record<string, unknown>;
  const transform = session.transform as Record<string, unknown> | undefined;
  return (
    session.boardId === boardId &&
    !!transform &&
    isFiniteNumber(transform.scale) &&
    transform.scale >= MIN_SCALE &&
    transform.scale <= MAX_SCALE &&
    isFiniteNumber(transform.translateX) &&
    isFiniteNumber(transform.translateY) &&
    VALID_TOOLS.includes(session.activeTool as ToolType)
  );
};

export const saveBoardSession = (session: BoardSession): void => {
  try {
    localStorage.setItem(STORAGE_PREFIX + session.boardId, JSON.stringify(session));
  } catch {
    // 存储不可用（隐私模式/配额满）时静默失败，不影响画板正常使用
  }
};

export const loadBoardSession = (boardId: string): LoadSessionResult => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_PREFIX + boardId);
  } catch {
    return { status: 'none' };
  }
  if (!raw) return { status: 'none' };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSession(parsed, boardId)) {
      throw new Error('invalid board session');
    }
    return { status: 'ok', session: parsed };
  } catch {
    // 数据损坏时清除，避免下次重复命中坏数据
    clearBoardSession(boardId);
    return { status: 'corrupted' };
  }
};

export const clearBoardSession = (boardId: string): void => {
  try {
    localStorage.removeItem(STORAGE_PREFIX + boardId);
  } catch {
    // ignore
  }
};
