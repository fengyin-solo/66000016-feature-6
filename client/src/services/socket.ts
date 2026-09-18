import { io, Socket } from 'socket.io-client';
import { CursorPosition, BoardElement, Layer, CanvasTransform } from '../types';

const SERVER_URL = '/';

class SocketService {
  private socket: Socket | null = null;
  private boardId: string | null = null;
  private username: string | null = null;

  connect(): Socket {
    if (!this.socket) {
      this.socket = io(SERVER_URL, {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        timeout: 10000,
      });
      // 断线重连后重新加入画板，让服务器下发最新在线成员名单
      this.socket.on('connect', () => {
        if (this.boardId && this.username) {
          this.socket?.emit('join-board', { boardId: this.boardId, username: this.username });
        }
      });
    }
    this.socket.connect();
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.boardId = null;
    this.username = null;
  }

  joinBoard(boardId: string, username: string): void {
    this.boardId = boardId;
    this.username = username;
    // 尚未连接时不主动发送，连接建立后由 connect 处理器统一发出
    if (this.socket?.connected) {
      this.socket.emit('join-board', { boardId, username });
    }
  }

  moveCursor(x: number, y: number): void {
    if (this.boardId) {
      this.socket?.emit('cursor-move', { boardId: this.boardId, x, y });
    }
  }

  drawElement(element: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('draw-element', { boardId: this.boardId, element, layerIndex });
    }
  }

  updateElement(elementId: string, updates: Partial<BoardElement>, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('update-element', { boardId: this.boardId, elementId, updates, layerIndex });
    }
  }

  deleteElement(elementId: string, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('delete-element', { boardId: this.boardId, elementId, layerIndex });
    }
  }

  addStickyNote(note: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('add-sticky-note', { boardId: this.boardId, note, layerIndex });
    }
  }

  addShape(shape: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('add-shape', { boardId: this.boardId, shape, layerIndex });
    }
  }

  updateLayers(layers: Layer[]): void {
    if (this.boardId) {
      this.socket?.emit('layer-update', { boardId: this.boardId, layers });
    }
  }

  canvasTransform(transform: CanvasTransform): void {
    if (this.boardId) {
      this.socket?.emit('canvas-transform', { boardId: this.boardId, transform });
    }
  }

  onUserJoined(callback: (data: { socketId: string; username: string }) => void): void {
    this.socket?.on('user-joined', callback);
  }

  onUserLeft(callback: (data: { socketId: string; username: string }) => void): void {
    this.socket?.on('user-left', callback);
  }

  onActiveUsers(callback: (users: CursorPosition[]) => void): void {
    this.socket?.on('active-users', callback);
  }

  onCursorUpdate(callback: (data: CursorPosition) => void): void {
    this.socket?.on('cursor-update', callback);
  }

  onElementAdded(callback: (data: { element: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('element-added', callback);
  }

  onElementUpdated(callback: (data: { elementId: string; updates: Partial<BoardElement>; layerIndex: number }) => void): void {
    this.socket?.on('element-updated', callback);
  }

  onElementDeleted(callback: (data: { elementId: string; layerIndex: number }) => void): void {
    this.socket?.on('element-deleted', callback);
  }

  onStickyNoteAdded(callback: (data: { note: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('sticky-note-added', callback);
  }

  onShapeAdded(callback: (data: { shape: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('shape-added', callback);
  }

  onLayersUpdated(callback: (data: { layers: Layer[] }) => void): void {
    this.socket?.on('layers-updated', callback);
  }

  onCanvasTransformed(callback: (data: { transform: CanvasTransform }) => void): void {
    this.socket?.on('canvas-transformed', callback);
  }

  off(event: string, callback?: (...args: unknown[]) => void): void {
    this.socket?.off(event, callback);
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
