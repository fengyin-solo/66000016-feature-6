const { v4: uuidv4 } = require('uuid');

const activeUsers = new Map(); // boardId -> Set of socket ids
const cursorPositions = new Map(); // socketId -> { x, y, username, boardId }

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-board', ({ boardId, username }) => {
      const existing = cursorPositions.get(socket.id);
      const alreadyInBoard = existing && existing.boardId === boardId;

      // 同一连接换画板时，先从旧画板的在场记录中移除并通知旧画板成员
      if (existing && existing.boardId !== boardId) {
        const prevUsers = activeUsers.get(existing.boardId);
        if (prevUsers) {
          prevUsers.delete(socket.id);
          if (prevUsers.size === 0) activeUsers.delete(existing.boardId);
        }
        socket.leave(`board:${existing.boardId}`);
        socket.to(`board:${existing.boardId}`).emit('user-left', { socketId: socket.id, username: existing.username });
      }

      socket.join(`board:${boardId}`);

      if (!activeUsers.has(boardId)) {
        activeUsers.set(boardId, new Set());
      }
      activeUsers.get(boardId).add(socket.id);

      cursorPositions.set(socket.id, {
        x: alreadyInBoard ? existing.x : 0,
        y: alreadyInBoard ? existing.y : 0,
        username,
        boardId
      });

      // 重复加入（断线重连等）不再重复广播加入通知
      if (!alreadyInBoard) {
        socket.to(`board:${boardId}`).emit('user-joined', { socketId: socket.id, username });
      }

      // 每次都重新下发当前在线成员，让加入方以服务器名单为准重新核对
      const users = [];
      for (const [sid, data] of cursorPositions) {
        if (data.boardId === boardId && sid !== socket.id) {
          users.push({ socketId: sid, username: data.username, x: data.x, y: data.y });
        }
      }
      socket.emit('active-users', users);
    });

    socket.on('cursor-move', ({ boardId, x, y }) => {
      const pos = cursorPositions.get(socket.id);
      if (pos) {
        pos.x = x;
        pos.y = y;
        socket.to(`board:${boardId}`).emit('cursor-update', {
          socketId: socket.id,
          username: pos.username,
          x, y
        });
      }
    });

    socket.on('draw-element', ({ boardId, element, layerIndex }) => {
      socket.to(`board:${boardId}`).emit('element-added', { element, layerIndex });
    });

    socket.on('update-element', ({ boardId, elementId, updates, layerIndex }) => {
      socket.to(`board:${boardId}`).emit('element-updated', { elementId, updates, layerIndex });
    });

    socket.on('delete-element', ({ boardId, elementId, layerIndex }) => {
      socket.to(`board:${boardId}`).emit('element-deleted', { elementId, layerIndex });
    });

    socket.on('add-sticky-note', ({ boardId, note, layerIndex }) => {
      socket.to(`board:${boardId}`).emit('sticky-note-added', { note, layerIndex });
    });

    socket.on('add-shape', ({ boardId, shape, layerIndex }) => {
      socket.to(`board:${boardId}`).emit('shape-added', { shape, layerIndex });
    });

    socket.on('layer-update', ({ boardId, layers }) => {
      socket.to(`board:${boardId}`).emit('layers-updated', { layers });
    });

    socket.on('canvas-transform', ({ boardId, transform }) => {
      socket.to(`board:${boardId}`).emit('canvas-transformed', { transform });
    });

    socket.on('disconnect', () => {
      const pos = cursorPositions.get(socket.id);
      if (pos) {
        const { boardId, username } = pos;
        const users = activeUsers.get(boardId);
        if (users) {
          users.delete(socket.id);
          if (users.size === 0) activeUsers.delete(boardId);
        }
        cursorPositions.delete(socket.id);
        socket.to(`board:${boardId}`).emit('user-left', { socketId: socket.id, username });
      }
      console.log(`User disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers };
