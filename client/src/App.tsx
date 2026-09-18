import React, { useState, useEffect, useRef, useCallback } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CursorOverlay } from './components/CursorOverlay';
import { Dashboard } from './components/Dashboard';
import { useWhiteboardStore, DEFAULT_CANVAS_TRANSFORM } from './store/whiteboard';
import { socketService } from './services/socket';
import { boardApi } from './services/api';
import { loadViewState, saveViewState, BoardViewState } from './services/viewState';
import { Board, BoardElement, CursorPosition, Layer, CanvasTransform, ViewType } from './types';

type BoardNotice =
  | { kind: 'restore'; state: BoardViewState }
  | { kind: 'corrupt' }
  | { kind: 'deleted' };

const SAVE_DEBOUNCE_MS = 500;

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const [boardMissing, setBoardMissing] = useState(false);

  const {
    setBoard, updateCursor, removeCursor, setCursors, clearCursors,
    resetCanvasTransform, setActiveTool, username
  } = useWhiteboardStore();

  // 恢复确认前不写回 localStorage，避免用默认位置覆盖上次保存的位置
  const persistenceEnabledRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistNow = useCallback(() => {
    const boardId = activeBoard?._id || socketService.getBoardId();
    if (!boardId || !persistenceEnabledRef.current) return;
    const { canvasTransform, activeTool } = useWhiteboardStore.getState();
    saveViewState(boardId, canvasTransform, activeTool);
  }, [activeBoard]);

  // 进入画板：核对画板是否存在、读取上次视图、加入协作
  useEffect(() => {
    if (currentView !== 'board' || !activeBoard) return;

    let cancelled = false;
    let connected = false;
    const boardMissingRef = { current: false };
    persistenceEnabledRef.current = false;
    setBoardMissing(false);
    setNotice(null);

    // 先回到默认位置并清空成员，等待服务端重新核对
    clearCursors();
    resetCanvasTransform(DEFAULT_CANVAS_TRANSFORM);
    setActiveTool('pen');
    setBoard(activeBoard);

    const joinRoom = () => {
      if (connected || boardMissingRef.current) return;
      connected = true;
      socketService.connect();
      socketService.joinBoard(activeBoard._id, username);

      socketService.onUserJoined((data) => {
        // 新成员先占位，active-users 到达后以服务端列表为准
        const { cursors } = useWhiteboardStore.getState();
        if (!cursors.has(data.socketId)) {
          updateCursor({ socketId: data.socketId, username: data.username, x: 0, y: 0 });
        }
      });
      socketService.onUserLeft((data) => {
        removeCursor(data.socketId);
      });
      socketService.onActiveUsers((users) => {
        // 服务端权威列表整体替换，已离开的成员不会残留
        setCursors(users);
      });
      socketService.onCursorUpdate((data: CursorPosition) => {
        updateCursor(data);
      });
      socketService.onElementAdded((data: { element: BoardElement; layerIndex: number }) => {
        const { board: currentBoard } = useWhiteboardStore.getState();
        if (currentBoard) {
          const layers = [...currentBoard.layers];
          layers[data.layerIndex] = {
            ...layers[data.layerIndex],
            elements: [...layers[data.layerIndex].elements, data.element]
          };
          setBoard({ ...currentBoard, layers });
        }
      });
      socketService.onLayersUpdated((data: { layers: Layer[] }) => {
        const { board: currentBoard } = useWhiteboardStore.getState();
        if (currentBoard) {
          setBoard({ ...currentBoard, layers: data.layers });
        }
      });
      socketService.onCanvasTransformed((data: { transform: CanvasTransform }) => {
        resetCanvasTransform(data.transform);
      });
    };

    (async () => {
      // 重新拉取画板，处理列表加载后被删除的情况
      let latest: Board | null;
      try {
        latest = await boardApi.getBoard(activeBoard._id);
      } catch {
        // 网络异常等非 404 错误仍按原流程进入
        latest = activeBoard;
      }
      if (cancelled) return;

      if (latest === null) {
        // 画板已删除：留在默认位置，不加入协作，顶部说明原因
        boardMissingRef.current = true;
        setBoardMissing(true);
        setNotice({ kind: 'deleted' });
        return;
      }

      setBoard(latest);

      // 工具选择立即恢复；缩放/平移通过顶部入口确认后恢复
      const result = loadViewState(activeBoard._id);
      if (cancelled) return;
      if (result.status === 'restored') {
        // 等待用户选择“恢复位置”或关闭前不写回，避免默认位置覆盖上次记录
        setActiveTool(result.state.tool);
        setNotice({ kind: 'restore', state: result.state });
      } else {
        // 无记录（首次进入）或记录损坏：当前默认位置即新起点，立即启用保存
        persistenceEnabledRef.current = true;
        if (result.status === 'corrupt') {
          setNotice({ kind: 'corrupt' });
        }
      }

      joinRoom();
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // 返回工作台前落盘当前视图
      if (connected) {
        persistNow();
        socketService.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, activeBoard, username]);

  // 视图/工具变化时防抖保存（恢复确认后才启用）
  useEffect(() => {
    if (currentView !== 'board' || !activeBoard || boardMissing) return;

    const unsubscribe = useWhiteboardStore.subscribe((state, prev) => {
      if (!persistenceEnabledRef.current) return;
      if (state.canvasTransform === prev.canvasTransform && state.activeTool === prev.activeTool) {
        return;
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveViewState(activeBoard._id, state.canvasTransform, state.activeTool);
      }, SAVE_DEBOUNCE_MS);
    });

    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      persistNow();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      unsubscribe();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [currentView, activeBoard, boardMissing, persistNow]);

  const handleBoardSelect = (boardItem: Board) => {
    setActiveBoard(boardItem);
    setCurrentView('board');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    setActiveBoard(null);
    setNotice(null);
    setBoardMissing(false);
  };

  const handleRestoreView = () => {
    if (notice?.kind !== 'restore') return;
    resetCanvasTransform(notice.state.transform);
    setActiveTool(notice.state.tool);
    persistenceEnabledRef.current = true;
    setNotice(null);
  };

  const handleDismissNotice = () => {
    if (notice?.kind === 'restore') {
      // 放弃恢复：以当前默认位置作为新的保存起点
      persistenceEnabledRef.current = true;
    }
    setNotice(null);
  };

  if (currentView === 'dashboard') {
    return <Dashboard onBoardSelect={handleBoardSelect} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div style={{
        height: '48px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '12px',
      }}>
        <button
          onClick={handleBackToDashboard}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#374151',
            background: '#f3f4f6',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#e5e7eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#f3f4f6';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回工作台
        </button>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#1a1a1a',
        }}>
          {activeBoard?.name}
        </div>
      </div>

      {notice && (
        <RestoreBanner
          notice={notice}
          onRestore={handleRestoreView}
          onDismiss={handleDismissNotice}
        />
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Toolbar />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <WhiteboardCanvas />
          <CursorOverlay />
        </div>
        <LayerPanel />
      </div>
    </div>
  );
};

const bannerBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 16px',
  fontSize: '13px',
  borderBottom: '1px solid',
};

const RestoreBanner: React.FC<{
  notice: BoardNotice;
  onRestore: () => void;
  onDismiss: () => void;
}> = ({ notice, onRestore, onDismiss }) => {
  const closeButton = (
    <button
      onClick={onDismiss}
      title="关闭"
      style={{
        marginLeft: 'auto',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: 1,
        padding: '2px 6px',
        borderRadius: '4px',
        color: '#6b7280',
      }}
    >
      ×
    </button>
  );

  if (notice.kind === 'restore') {
    return (
      <div style={{ ...bannerBaseStyle, background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }}>
        <span>🔖 检测到上次离开时的缩放与平移位置，是否恢复？（当前工具已保留）</span>
        <button
          onClick={onRestore}
          style={{
            padding: '4px 12px', fontSize: '12px', fontWeight: 500,
            color: '#fff', background: '#2563eb', border: 'none',
            borderRadius: '6px', cursor: 'pointer',
          }}
        >
          恢复位置
        </button>
        {closeButton}
      </div>
    );
  }

  if (notice.kind === 'corrupt') {
    return (
      <div style={{ ...bannerBaseStyle, background: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}>
        <span>
          ⚠️ 上次视图的恢复信息已损坏，已回到默认位置。工具选择已重置为默认画笔。
        </span>
        {closeButton}
      </div>
    );
  }

  return (
    <div style={{ ...bannerBaseStyle, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}>
      <span>
        🗑️ 该画板已被删除，无法恢复上次位置，当前停留在默认视图。可返回工作台选择其他白板。
      </span>
      {closeButton}
    </div>
  );
};

export default App;
