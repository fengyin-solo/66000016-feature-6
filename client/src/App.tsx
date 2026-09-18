import React, { useState, useEffect } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CursorOverlay } from './components/CursorOverlay';
import { Dashboard } from './components/Dashboard';
import { useWhiteboardStore } from './store/whiteboard';
import { socketService } from './services/socket';
import { boardApi } from './services/api';
import { BoardSession, clearBoardSession, loadBoardSession } from './services/boardSession';
import { Board, BoardElement, CursorPosition, Layer, CanvasTransform, ViewType } from './types';

const DEFAULT_TRANSFORM: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const [restorableSession, setRestorableSession] = useState<BoardSession | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const {
    setBoard, updateCursor, removeCursor, setCursors, clearCursors, username
  } = useWhiteboardStore();

  useEffect(() => {
    if (currentView === 'board' && activeBoard) {
      setBoard(activeBoard);
      setRestorableSession(null);
      setSessionNotice(null);
      // 进入画板先回到默认位置，再根据本地保存的状态决定是否提供恢复入口
      useWhiteboardStore.getState().applyCanvasTransform(DEFAULT_TRANSFORM);

      let cancelled = false;
      const checkBoardAndSession = async () => {
        let boardMissing = false;
        try {
          const freshBoard = await boardApi.getBoard(activeBoard._id);
          boardMissing = !freshBoard;
        } catch {
          // 网络异常时无法确认画板是否被删除，按画板仍存在处理
        }
        if (cancelled) return;

        if (boardMissing) {
          clearBoardSession(activeBoard._id);
          setSessionNotice('该画板已被删除，无法恢复上次的浏览状态，已回到默认位置');
          return;
        }

        const result = loadBoardSession(activeBoard._id);
        if (result.status === 'ok') {
          setRestorableSession(result.session);
        } else if (result.status === 'corrupted') {
          setSessionNotice('上次保存的浏览状态已损坏，无法恢复，已回到默认位置');
        }
      };
      checkBoardAndSession();

      socketService.connect();
      socketService.joinBoard(activeBoard._id, username);

      socketService.onUserJoined((data) => {
        console.log(`${data.username} 加入了白板`);
      });
      socketService.onUserLeft((data) => {
        removeCursor(data.socketId);
      });
      socketService.onActiveUsers((users) => {
        // 以服务器下发的最新名单为准，整体替换，已离开的人不再出现
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
        useWhiteboardStore.getState().applyCanvasTransform(data.transform);
      });

      return () => {
        cancelled = true;
        socketService.disconnect();
        // 离开画板时清空在线成员，重新进入时以服务器最新名单重新核对
        clearCursors();
      };
    }
  }, [currentView, activeBoard]);

  const handleBoardSelect = (boardItem: Board) => {
    setActiveBoard(boardItem);
    setCurrentView('board');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    setActiveBoard(null);
  };

  const handleRestoreSession = () => {
    if (!restorableSession) return;
    const { applyCanvasTransform, setActiveTool } = useWhiteboardStore.getState();
    applyCanvasTransform(restorableSession.transform);
    setActiveTool(restorableSession.activeTool);
    setRestorableSession(null);
  };

  const handleDismissRestore = () => {
    // 用户选择不恢复，丢弃已保存的状态，避免下次重复提示
    if (activeBoard) {
      clearBoardSession(activeBoard._id);
    }
    setRestorableSession(null);
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
      {(restorableSession || sessionNotice) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 16px',
          fontSize: '13px',
          background: sessionNotice ? '#fffbeb' : '#eff6ff',
          borderBottom: `1px solid ${sessionNotice ? '#fde68a' : '#bfdbfe'}`,
          color: sessionNotice ? '#92400e' : '#1e40af',
        }}>
          <span style={{ flex: 1 }}>
            {sessionNotice ??
              `检测到你上次在此画板的浏览状态（缩放 ${Math.round(restorableSession!.transform.scale * 100)}%），是否恢复？`}
          </span>
          {!sessionNotice && (
            <button
              onClick={handleRestoreSession}
              style={{
                padding: '4px 12px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#fff',
                background: '#3b82f6',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              恢复上次状态
            </button>
          )}
          <button
            onClick={sessionNotice ? () => setSessionNotice(null) : handleDismissRestore}
            title="关闭"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              padding: 0,
              fontSize: '14px',
              lineHeight: 1,
              color: 'inherit',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
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

export default App;
