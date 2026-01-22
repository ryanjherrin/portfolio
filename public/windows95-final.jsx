'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react';

// Mobile detection hook
const useDeviceMode = () => {
  const [state, setState] = useState({
    isNarrow: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
    isTouchPrimary: typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false,
  });

  useEffect(() => {
    const checkDevice = () => {
      setState({
        isNarrow: window.innerWidth < 768,
        isTouchPrimary: window.matchMedia('(pointer: coarse)').matches,
      });
    };

    window.addEventListener('resize', checkDevice);
    checkDevice();
    
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  return {
    ...state,
    layoutMode: state.isNarrow ? 'mobile' : 'desktop',
    inputMode: state.isTouchPrimary ? 'touch' : 'mouse',
    isMobile: state.isNarrow || state.isTouchPrimary,
  };
};

// Window snapping configuration

// Window snapping configuration
const SNAP_DISTANCE = 12; // pixels - how close before snapping kicks in

// Snap to screen edges
const snapToScreen = (nextX, nextY, win, viewport) => {
  let x = nextX;
  let y = nextY;

  // Left edge
  if (Math.abs(nextX) < SNAP_DISTANCE) x = 0;
  
  // Top edge
  if (Math.abs(nextY) < SNAP_DISTANCE) y = 0;
  
  // Right edge
  const right = nextX + win.width;
  const screenRight = viewport.width;
  if (Math.abs(screenRight - right) < SNAP_DISTANCE) {
    x = screenRight - win.width;
  }
  
  // Bottom edge (account for taskbar)
  const bottom = nextY + win.height;
  const screenBottom = viewport.height - 30; // taskbar height
  if (Math.abs(screenBottom - bottom) < SNAP_DISTANCE) {
    y = screenBottom - win.height;
  }

  return { x, y };
};

// Snap to other windows
const snapToWindows = (nextX, nextY, win, allWindows, currentId) => {
  let x = nextX;
  let y = nextY;

  const L = nextX;
  const R = nextX + win.width;
  const T = nextY;
  const B = nextY + win.height;

  let bestDx = 0;
  let bestDy = 0;
  let bestDistX = SNAP_DISTANCE + 1;
  let bestDistY = SNAP_DISTANCE + 1;

  Object.entries(allWindows).forEach(([id, w]) => {
    if (id === currentId || !w.isOpen || w.isMinimized) return;

    const L2 = w.position.x;
    const R2 = w.position.x + w.size.width;
    const T2 = w.position.y;
    const B2 = w.position.y + w.size.height;

    // Check for horizontal overlap (windows are vertically aligned enough to snap horizontally)
    const horizontalOverlap = !(B < T2 || T > B2);
    // Check for vertical overlap (windows are horizontally aligned enough to snap vertically)
    const verticalOverlap = !(R < L2 || L > R2);

    if (horizontalOverlap) {
      // Snap left edge of current window to right edge of other window
      const distLtoR = Math.abs(L - R2);
      if (distLtoR < bestDistX && distLtoR < SNAP_DISTANCE) {
        bestDistX = distLtoR;
        bestDx = R2 - L;
      }

      // Snap right edge of current window to left edge of other window
      const distRtoL = Math.abs(R - L2);
      if (distRtoL < bestDistX && distRtoL < SNAP_DISTANCE) {
        bestDistX = distRtoL;
        bestDx = L2 - R;
      }
    }

    if (verticalOverlap) {
      // Snap top edge to bottom edge
      const distTtoB = Math.abs(T - B2);
      if (distTtoB < bestDistY && distTtoB < SNAP_DISTANCE) {
        bestDistY = distTtoB;
        bestDy = B2 - T;
      }

      // Snap bottom edge to top edge
      const distBtoT = Math.abs(B - T2);
      if (distBtoT < bestDistY && distBtoT < SNAP_DISTANCE) {
        bestDistY = distBtoT;
        bestDy = T2 - B;
      }
    }
  });

  x += bestDx;
  y += bestDy;

  return { x, y };
};

// Combined snapping function
const getSnappedPosition = (nextX, nextY, win, allWindows, currentId, viewport) => {
  // First snap to screen edges
  let { x, y } = snapToScreen(nextX, nextY, win, viewport);
  // Then snap to other windows
  ({ x, y } = snapToWindows(x, y, { ...win, width: win.width, height: win.height }, allWindows, currentId));
  
  // Clamp to screen bounds (allow window to be partially off-screen but still grabbable)
  const minX = -win.width + 100; // Keep at least 100px visible on left
  const maxX = viewport.width - 100; // Keep at least 100px visible on right
  const minY = 0;
  const maxY = viewport.height - 60; // Account for taskbar
  
  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));
  
  return { x, y };
};

// Windows 95 color palette
const colors = {
  bg: '#008080',
  gray: '#c0c0c0',
  darkGray: '#808080',
  darkerGray: '#404040',
  white: '#ffffff',
  titleActive: '#000080',
  black: '#000000',
};

// Classic 3D border styles
const raised = {
  borderTop: `2px solid ${colors.white}`,
  borderLeft: `2px solid ${colors.white}`,
  borderBottom: `2px solid ${colors.darkerGray}`,
  borderRight: `2px solid ${colors.darkerGray}`,
};

const inset = {
  borderTop: `2px solid ${colors.darkerGray}`,
  borderLeft: `2px solid ${colors.darkerGray}`,
  borderBottom: `2px solid ${colors.white}`,
  borderRight: `2px solid ${colors.white}`,
};

// Pixel Art Icons
const PixelIcon = ({ type, size = 32 }) => {
  const icons = {
    computer: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="2" y="2" width="12" height="8" fill="#c0c0c0"/>
        <rect x="3" y="3" width="10" height="6" fill="#000080"/>
        <rect x="4" y="4" width="8" height="4" fill="#008080"/>
        <rect x="5" y="11" width="6" height="1" fill="#c0c0c0"/>
        <rect x="4" y="12" width="8" height="2" fill="#c0c0c0"/>
      </svg>
    ),
    folder: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="1" y="4" width="14" height="10" fill="#c0a000"/>
        <rect x="1" y="3" width="6" height="2" fill="#c0a000"/>
        <rect x="2" y="5" width="12" height="8" fill="#ffff00"/>
      </svg>
    ),
    notepad: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="3" y="1" width="10" height="14" fill="#ffffff"/>
        <rect x="4" y="1" width="8" height="2" fill="#000080"/>
        <rect x="5" y="4" width="6" height="1" fill="#000000"/>
        <rect x="5" y="6" width="6" height="1" fill="#000000"/>
        <rect x="5" y="8" width="4" height="1" fill="#000000"/>
        <rect x="5" y="10" width="6" height="1" fill="#000000"/>
      </svg>
    ),
    mail: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="1" y="3" width="14" height="10" fill="#c0c0c0"/>
        <rect x="2" y="4" width="12" height="8" fill="#ffffff"/>
        <path d="M2 4 L8 8 L14 4" stroke="#c0a000" strokeWidth="1" fill="none"/>
        <rect x="2" y="4" width="1" height="1" fill="#c0a000"/>
        <rect x="13" y="4" width="1" height="1" fill="#c0a000"/>
      </svg>
    ),
    terminal: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="1" y="2" width="14" height="12" fill="#000000"/>
        <rect x="2" y="3" width="12" height="10" fill="#000000"/>
        <rect x="3" y="4" width="1" height="1" fill="#c0c0c0"/>
        <rect x="4" y="4" width="1" height="1" fill="#c0c0c0"/>
        <rect x="6" y="4" width="4" height="1" fill="#c0c0c0"/>
        <rect x="3" y="6" width="2" height="1" fill="#00ff00"/>
      </svg>
    ),
    user: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="6" y="2" width="4" height="4" fill="#ffcc99"/>
        <rect x="5" y="6" width="6" height="6" fill="#000080"/>
        <rect x="4" y="12" width="8" height="2" fill="#000080"/>
        <rect x="7" y="3" width="2" height="1" fill="#000000"/>
      </svg>
    ),
    recycle: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="4" y="3" width="8" height="11" fill="#c0c0c0"/>
        <rect x="5" y="4" width="6" height="9" fill="#ffffff"/>
        <rect x="3" y="2" width="10" height="2" fill="#c0c0c0"/>
        <rect x="6" y="1" width="4" height="2" fill="#c0c0c0"/>
        <rect x="6" y="5" width="1" height="6" fill="#808080"/>
        <rect x="9" y="5" width="1" height="6" fill="#808080"/>
      </svg>
    ),
    minesweeper: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="1" y="1" width="14" height="14" fill="#c0c0c0"/>
        <rect x="2" y="2" width="4" height="4" fill="#ffffff"/>
        <rect x="6" y="2" width="4" height="4" fill="#c0c0c0"/>
        <rect x="10" y="2" width="4" height="4" fill="#ffffff"/>
        <rect x="2" y="6" width="4" height="4" fill="#c0c0c0"/>
        <circle cx="8" cy="8" r="2" fill="#000000"/>
        <rect x="10" y="6" width="4" height="4" fill="#c0c0c0"/>
        <rect x="4" y="4" width="1" height="1" fill="#0000ff"/>
        <rect x="12" y="8" width="1" height="1" fill="#ff0000"/>
      </svg>
    ),
    help: (
      <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
        <rect x="2" y="1" width="12" height="14" fill="#ffff00"/>
        <rect x="6" y="3" width="4" height="1" fill="#000000"/>
        <rect x="5" y="4" width="2" height="1" fill="#000000"/>
        <rect x="9" y="4" width="2" height="1" fill="#000000"/>
        <rect x="9" y="5" width="2" height="2" fill="#000000"/>
        <rect x="7" y="7" width="2" height="2" fill="#000000"/>
        <rect x="7" y="10" width="2" height="2" fill="#000000"/>
      </svg>
    ),
  };
  return icons[type] || icons.folder;
};

// Windows 95 Startup Sound
const playStartupSound = () => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  const playNote = (freq, start, duration, type = 'sine', gain = 0.3) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = freq;
    oscillator.type = type;
    gainNode.gain.setValueAtTime(gain, audioContext.currentTime + start);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + start + duration);
    oscillator.start(audioContext.currentTime + start);
    oscillator.stop(audioContext.currentTime + start + duration);
  };

  const notes = [
    { freq: 523.25, start: 0, duration: 0.3 },
    { freq: 659.25, start: 0.15, duration: 0.3 },
    { freq: 783.99, start: 0.3, duration: 0.3 },
    { freq: 1046.50, start: 0.45, duration: 0.6 },
    { freq: 783.99, start: 0.6, duration: 0.4 },
    { freq: 1046.50, start: 0.75, duration: 0.8 },
  ];

  notes.forEach(note => {
    playNote(note.freq, note.start, note.duration, 'sine', 0.2);
    playNote(note.freq * 2, note.start, note.duration, 'sine', 0.05);
  });
};

// Boot Screen
const BootScreen = ({ onComplete }) => {
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer1 = setTimeout(() => setStage(1), 800);
    const timer2 = setTimeout(() => setStage(2), 2500);
    const timer3 = setTimeout(() => {
      playStartupSound();
      setTimeout(onComplete, 1000);
    }, 2800);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  useEffect(() => {
    if (stage === 1) {
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + Math.random() * 15, 100));
      }, 150);
      return () => clearInterval(interval);
    }
  }, [stage]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-[9999]">
      {stage >= 0 && (
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <svg viewBox="0 0 4 4" className="w-16 h-16">
              <rect x="0" y="0" width="1.8" height="1.8" fill="#ff0000"/>
              <rect x="2.2" y="0" width="1.8" height="1.8" fill="#00ff00"/>
              <rect x="0" y="2.2" width="1.8" height="1.8" fill="#0000ff"/>
              <rect x="2.2" y="2.2" width="1.8" height="1.8" fill="#ffff00"/>
            </svg>
          </div>
          <div className="text-white text-2xl font-bold" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>
            Microsoft<span className="font-black">®</span> Windows 95
          </div>
          <div className="text-gray-500 text-sm mt-2" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>
            Portfolio Edition
          </div>
        </div>
      )}
      
      {stage >= 1 && (
        <div className="w-64">
          <div className="h-5 p-1" style={{ backgroundColor: colors.gray, ...inset }}>
            <div 
              className="h-full transition-all duration-150"
              style={{ width: `${progress}%`, backgroundColor: '#000080' }}
            />
          </div>
          <div className="text-gray-400 text-xs mt-2 text-center" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>
            {progress < 30 && "Loading system files..."}
            {progress >= 30 && progress < 60 && "Initializing portfolio..."}
            {progress >= 60 && progress < 90 && "Loading case studies..."}
            {progress >= 90 && "Starting Windows 95..."}
          </div>
        </div>
      )}
    </div>
  );
};

// Draggable Clippy
const Clippy = ({ onClose }) => {
  const [message, setMessage] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [position, setPosition] = useState({ x: window.innerWidth - 280, y: window.innerHeight - 200 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  
  const messages = [
    "Hi! I'm Clippy! 📎 It looks like you're viewing a portfolio. Would you like help?",
    "Tip: Double-click on desktop icons to open applications!",
    "Did you know? Ryan has shipped over 40 products! Click 'My Projects' to see them.",
    "Fun fact: Windows 95 sold 7 million copies in its first 5 weeks!",
    "Try playing Minesweeper! It's a great way to see attention to detail.",
    "Looking to hire? Click 'Contact' to get in touch with Ryan!",
    "Pro tip: Drag windows near edges or other windows — they snap into place!",
    "Psst... you can drag me around too! Try it! 🖱️",
  ];

  const nextMessage = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setMessage((m) => (m + 1) % messages.length);
      setIsAnimating(false);
    }, 200);
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - dragOffset.current.x)),
      y: Math.max(0, Math.min(window.innerHeight - 150, e.clientY - dragOffset.current.y))
    });
  }, [isDragging]);

  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove]);

  return (
    <div 
      className="fixed z-[100] flex flex-col items-end gap-2"
      style={{ 
        left: position.x, 
        top: position.y,
        fontFamily: '"MS Sans Serif", Tahoma, sans-serif',
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
      {/* Speech bubble */}
      <div 
        className="max-w-[240px] p-3 text-xs relative"
        style={{ 
          backgroundColor: '#ffffcc', 
          ...raised,
          boxShadow: '2px 2px 0 rgba(0,0,0,0.3)'
        }}
      >
        <button 
          onClick={onClose}
          className="absolute -top-1 -right-1 w-4 h-4 text-[10px] flex items-center justify-center hover:bg-red-200"
          style={{ backgroundColor: colors.gray, ...raised }}
        >
          ✕
        </button>
        <p className={`transition-opacity ${isAnimating ? 'opacity-0' : 'opacity-100'}`}>
          {messages[message]}
        </p>
        <div className="flex gap-1 mt-2">
          <button 
            onClick={nextMessage}
            className="px-2 py-0.5 text-[10px] hover:bg-gray-200"
            style={{ backgroundColor: colors.gray, ...raised }}
          >
            Next Tip
          </button>
          <button 
            onClick={onClose}
            className="px-2 py-0.5 text-[10px] hover:bg-gray-200"
            style={{ backgroundColor: colors.gray, ...raised }}
          >
            Go Away
          </button>
        </div>
        {/* Speech bubble tail */}
        <div 
          className="absolute -bottom-2 right-8 w-4 h-4"
          style={{ 
            backgroundColor: '#ffffcc',
            clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
          }}
        />
      </div>
      
      {/* Clippy character - draggable */}
      <div 
        className="w-16 h-20 flex items-center justify-center text-5xl select-none"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
      >
        <span className={isDragging ? '' : 'animate-bounce'} style={{ animationDuration: '2s' }}>
          📎
        </span>
      </div>
    </div>
  );
};

// Minesweeper
const Minesweeper = () => {
  const [grid, setGrid] = useState([]);
  const [gameState, setGameState] = useState('playing');
  const [flagCount, setFlagCount] = useState(0);
  const ROWS = 8;
  const COLS = 8;
  const MINES = 10;

  const initGame = useCallback(() => {
    let newGrid = Array(ROWS).fill(null).map(() => 
      Array(COLS).fill(null).map(() => ({
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        neighborMines: 0,
      }))
    );

    let minesPlaced = 0;
    while (minesPlaced < MINES) {
      const r = Math.floor(Math.random() * ROWS);
      const c = Math.floor(Math.random() * COLS);
      if (!newGrid[r][c].isMine) {
        newGrid[r][c].isMine = true;
        minesPlaced++;
      }
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!newGrid[r][c].isMine) {
          let count = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && newGrid[nr][nc].isMine) {
                count++;
              }
            }
          }
          newGrid[r][c].neighborMines = count;
        }
      }
    }

    setGrid(newGrid);
    setGameState('playing');
    setFlagCount(0);
  }, []);

  useEffect(() => { initGame(); }, [initGame]);

  const revealCell = (r, c) => {
    if (gameState !== 'playing' || grid[r][c].isRevealed || grid[r][c].isFlagged) return;

    const newGrid = grid.map(row => row.map(cell => ({ ...cell })));
    
    if (newGrid[r][c].isMine) {
      newGrid.forEach(row => row.forEach(cell => {
        if (cell.isMine) cell.isRevealed = true;
      }));
      setGrid(newGrid);
      setGameState('lost');
      return;
    }

    const reveal = (row, col) => {
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
      if (newGrid[row][col].isRevealed || newGrid[row][col].isFlagged || newGrid[row][col].isMine) return;
      
      newGrid[row][col].isRevealed = true;
      
      if (newGrid[row][col].neighborMines === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            reveal(row + dr, col + dc);
          }
        }
      }
    };

    reveal(r, c);
    setGrid(newGrid);

    const unrevealed = newGrid.flat().filter(c => !c.isRevealed && !c.isMine).length;
    if (unrevealed === 0) setGameState('won');
  };

  const toggleFlag = (e, r, c) => {
    e.preventDefault();
    if (gameState !== 'playing' || grid[r][c].isRevealed) return;

    const newGrid = grid.map(row => row.map(cell => ({ ...cell })));
    newGrid[r][c].isFlagged = !newGrid[r][c].isFlagged;
    setGrid(newGrid);
    setFlagCount(f => newGrid[r][c].isFlagged ? f + 1 : f - 1);
  };

  const getCellContent = (cell) => {
    if (cell.isFlagged) return '🚩';
    if (!cell.isRevealed) return '';
    if (cell.isMine) return '💣';
    if (cell.neighborMines === 0) return '';
    return cell.neighborMines;
  };

  const getNumberColor = (num) => {
    const numColors = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
    return numColors[num] || '#000000';
  };

  const faceEmoji = gameState === 'won' ? '😎' : gameState === 'lost' ? '😵' : '🙂';

  return (
    <div className="p-2 select-none" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', fontSize: '12px' }}>
      <div className="flex items-center justify-between p-1 mb-2" style={{ ...inset, backgroundColor: colors.gray }}>
        <div className="w-10 h-6 flex items-center justify-center text-red-600 font-bold" style={{ backgroundColor: '#000', fontFamily: 'monospace' }}>
          {String(MINES - flagCount).padStart(3, '0')}
        </div>
        <button onClick={initGame} className="w-7 h-7 flex items-center justify-center text-lg" style={{ backgroundColor: colors.gray, ...raised }}>
          {faceEmoji}
        </button>
        <div className="w-10 h-6 flex items-center justify-center text-red-600 font-bold" style={{ backgroundColor: '#000', fontFamily: 'monospace' }}>
          000
        </div>
      </div>
      
      <div className="inline-block" style={{ ...inset }}>
        {grid.map((row, r) => (
          <div key={r} className="flex">
            {row.map((cell, c) => (
              <button
                key={c}
                onClick={() => revealCell(r, c)}
                onContextMenu={(e) => toggleFlag(e, r, c)}
                className="w-5 h-5 flex items-center justify-center text-xs font-bold"
                style={{
                  ...(cell.isRevealed ? { backgroundColor: '#c0c0c0', border: '1px solid #808080' } : { backgroundColor: colors.gray, ...raised }),
                  color: getNumberColor(cell.neighborMines),
                  fontSize: '11px',
                }}
              >
                {getCellContent(cell)}
              </button>
            ))}
          </div>
        ))}
      </div>
      
      {gameState !== 'playing' && (
        <div className="mt-2 text-center text-sm font-bold">
          {gameState === 'won' ? '🎉 You Win!' : '💥 Game Over!'}
        </div>
      )}
    </div>
  );
};

// Button
const Button95 = ({ children, onClick, active, style, className = '' }) => {
  const [pressed, setPressed] = useState(false);
  
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      className={`px-4 py-1 font-bold text-sm select-none ${className}`}
      style={{
        backgroundColor: colors.gray,
        ...(pressed || active ? inset : raised),
        fontFamily: '"MS Sans Serif", Tahoma, sans-serif',
        ...style,
      }}
    >
      {children}
    </button>
  );
};

// Resizable Window
const Window95 = ({ id, title, icon, children, position, size, zIndex, isMinimized, isMaximized, onClose, onMinimize, onMaximize, onFocus, onDrag, onResize, hideMenuBar, minWidth = 200, minHeight = 150, allWindows, isMobile, isTouch }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });
  const animationFrameRef = useRef(null);

  // On mobile, windows are always maximized
  const effectivelyMaximized = isMobile || isMaximized;

  // Dragging handlers - disabled on mobile
  const handleDragMouseDown = (e) => {
    if (isMobile) return; // No dragging on mobile
    if (e.target.closest('.window-controls')) return;
    if (isMaximized) return;
    onFocus(id);
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const handleDragMouseMove = useCallback((e) => {
    if (!isDragging || isMobile) return;
    
    // Throttle with requestAnimationFrame for performance
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animationFrameRef.current = requestAnimationFrame(() => {
      const nextX = e.clientX - dragOffset.current.x;
      const nextY = e.clientY - dragOffset.current.y;
      
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };
      
      // Apply snapping
      const snapped = getSnappedPosition(
        nextX, 
        nextY, 
        size, 
        allWindows, 
        id, 
        viewport
      );
      
      onDrag(id, snapped);
    });
  }, [isDragging, id, onDrag, size, allWindows, isMobile]);

  const handleDragMouseUp = () => {
    setIsDragging(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };

  // Resize handlers - disabled on mobile
  const handleResizeMouseDown = (e, direction) => {
    if (isMobile) return; // No resizing on mobile
    e.preventDefault();
    e.stopPropagation();
    if (isMaximized) return;
    onFocus(id);
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y
    };
  };

  const handleResizeMouseMove = useCallback((e) => {
    if (!isResizing || !resizeDirection || isMobile) return;
    
    const deltaX = e.clientX - resizeStart.current.x;
    const deltaY = e.clientY - resizeStart.current.y;
    
    let newWidth = resizeStart.current.width;
    let newHeight = resizeStart.current.height;
    let newX = resizeStart.current.posX;
    let newY = resizeStart.current.posY;

    // Handle horizontal resize
    if (resizeDirection.includes('e')) {
      newWidth = Math.max(minWidth, resizeStart.current.width + deltaX);
    }
    if (resizeDirection.includes('w')) {
      const proposedWidth = resizeStart.current.width - deltaX;
      if (proposedWidth >= minWidth) {
        newWidth = proposedWidth;
        newX = resizeStart.current.posX + deltaX;
      }
    }

    // Handle vertical resize
    if (resizeDirection.includes('s')) {
      newHeight = Math.max(minHeight, resizeStart.current.height + deltaY);
    }
    if (resizeDirection.includes('n')) {
      const proposedHeight = resizeStart.current.height - deltaY;
      if (proposedHeight >= minHeight) {
        newHeight = proposedHeight;
        newY = resizeStart.current.posY + deltaY;
      }
    }

    onResize(id, { width: newWidth, height: newHeight });
    if (newX !== position.x || newY !== position.y) {
      onDrag(id, { x: newX, y: newY });
    }
  }, [isResizing, resizeDirection, id, onResize, onDrag, minWidth, minHeight, position.x, position.y]);

  const handleResizeMouseUp = () => {
    setIsResizing(false);
    setResizeDirection(null);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMouseMove);
      window.addEventListener('mouseup', handleDragMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleDragMouseMove);
        window.removeEventListener('mouseup', handleDragMouseUp);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }
  }, [isDragging, handleDragMouseMove]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMouseMove);
      window.addEventListener('mouseup', handleResizeMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleResizeMouseMove);
        window.removeEventListener('mouseup', handleResizeMouseUp);
      };
    }
  }, [isResizing, handleResizeMouseMove]);

  if (isMinimized) return null;

  // Mobile taskbar height is taller
  const taskbarHeight = isMobile ? 56 : 30;
  
  const windowStyle = effectivelyMaximized 
    ? { top: 0, left: 0, width: '100%', height: `calc(100% - ${taskbarHeight}px)`, zIndex }
    : { top: position.y, left: position.x, width: size.width, height: size.height, zIndex };

  // Resize handle styles - not used on mobile
  const resizeHandleBase = "absolute bg-transparent";
  const resizeHandles = [
    { dir: 'n', className: `${resizeHandleBase} top-0 left-2 right-2 h-1 cursor-n-resize` },
    { dir: 's', className: `${resizeHandleBase} bottom-0 left-2 right-2 h-1 cursor-s-resize` },
    { dir: 'e', className: `${resizeHandleBase} right-0 top-2 bottom-2 w-1 cursor-e-resize` },
    { dir: 'w', className: `${resizeHandleBase} left-0 top-2 bottom-2 w-1 cursor-w-resize` },
    { dir: 'nw', className: `${resizeHandleBase} top-0 left-0 w-2 h-2 cursor-nw-resize` },
    { dir: 'ne', className: `${resizeHandleBase} top-0 right-0 w-2 h-2 cursor-ne-resize` },
    { dir: 'sw', className: `${resizeHandleBase} bottom-0 left-0 w-2 h-2 cursor-sw-resize` },
    { dir: 'se', className: `${resizeHandleBase} bottom-0 right-0 w-2 h-2 cursor-se-resize` },
  ];

  // Mobile-friendly sizes
  const titleBarHeight = isMobile ? 'h-10' : 'h-7';
  const buttonSize = isMobile ? 'w-7 h-7' : 'w-[18px] h-[18px]';
  const iconSvgSize = isMobile ? 12 : 8;
  const maxSvgSize = isMobile ? 14 : 10;

  return (
    <div
      className="absolute flex flex-col"
      style={{
        ...windowStyle,
        backgroundColor: colors.gray,
        ...raised,
        boxShadow: '2px 2px 0 rgba(0,0,0,0.5)',
      }}
      onMouseDown={() => onFocus(id)}
    >
      {/* Resize handles - only on desktop and non-maximized */}
      {!effectivelyMaximized && !isMobile && resizeHandles.map(({ dir, className }) => (
        <div
          key={dir}
          className={className}
          onMouseDown={(e) => handleResizeMouseDown(e, dir)}
        />
      ))}

      {/* Title bar */}
      <div 
        className={`${titleBarHeight} flex items-center px-1 gap-1.5 select-none shrink-0 mx-0.5 mt-0.5`}
        style={{ 
          background: `linear-gradient(90deg, ${colors.titleActive} 0%, #1084d0 100%)`,
          touchAction: 'none' // Prevent scroll on title bar
        }}
        onMouseDown={handleDragMouseDown}
      >
        <div className={`${isMobile ? 'w-6 h-6' : 'w-4 h-4'} flex items-center justify-center shrink-0`}>{icon}</div>
        <span className={`text-white ${isMobile ? 'text-sm' : 'text-xs'} font-bold flex-1 truncate`} style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>
          {title}
        </span>
        
        <div className="window-controls flex gap-1">
          {/* Minimize button - hidden on mobile since windows are always maximized */}
          {!isMobile && (
            <button 
              onClick={() => onMinimize(id)} 
              className={`${buttonSize} flex items-center justify-center active:pt-px active:pl-px`}
              style={{ backgroundColor: colors.gray, ...raised }}
            >
              <svg width={iconSvgSize} height={iconSvgSize} viewBox="0 0 8 8">
                <rect x="0" y="6" width="8" height="2" fill="black"/>
              </svg>
            </button>
          )}
          {/* Maximize button - hidden on mobile */}
          {!isMobile && (
            <button 
              onClick={() => onMaximize(id)} 
              className={`${buttonSize} flex items-center justify-center active:pt-px active:pl-px`}
              style={{ backgroundColor: colors.gray, ...raised }}
            >
              <svg width={maxSvgSize} height={maxSvgSize} viewBox="0 0 10 10">
                <rect x="0" y="0" width="10" height="10" fill="none" stroke="black" strokeWidth="1"/>
                <rect x="0" y="0" width="10" height="2" fill="black"/>
              </svg>
            </button>
          )}
          {/* Close button */}
          <button 
            onClick={() => onClose(id)} 
            className={`${buttonSize} flex items-center justify-center active:pt-px active:pl-px`}
            style={{ backgroundColor: colors.gray, ...raised }}
          >
            <svg width={iconSvgSize} height={iconSvgSize} viewBox="0 0 8 8">
              <path d="M0 0 L8 8 M8 0 L0 8" stroke="black" strokeWidth="1.5"/>
            </svg>
          </button>
        </div>
      </div>
      
      {/* Menu bar */}
      {!hideMenuBar && (
        <div className="h-6 flex items-center px-1 text-xs" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>F</u>ile</span>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>E</u>dit</span>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>V</u>iew</span>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>H</u>elp</span>
        </div>
      )}
      
      {/* Content */}
      <div className="flex-1 overflow-auto m-0.5" style={{ ...inset, backgroundColor: colors.white }}>
        {children}
      </div>
      
      {/* Status bar with resize grip */}
      <div className={`${isMobile ? 'h-8' : 'h-6'} flex items-center px-1 ${isMobile ? 'text-sm' : 'text-xs'} shrink-0`} style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>
        <div className="flex-1 px-2 h-4 flex items-center" style={inset}>Ready</div>
        {!effectivelyMaximized && !isMobile && (
          <div 
            className="w-4 h-4 cursor-se-resize flex items-end justify-end ml-1"
            onMouseDown={(e) => handleResizeMouseDown(e, 'se')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M10 0 L12 0 L12 2 Z" fill="#808080"/>
              <path d="M10 0 L10 2 L12 2 Z" fill="#ffffff"/>
              <path d="M6 4 L8 4 L8 6 Z" fill="#808080"/>
              <path d="M6 4 L6 6 L8 6 Z" fill="#ffffff"/>
              <path d="M10 4 L12 4 L12 6 Z" fill="#808080"/>
              <path d="M10 4 L10 6 L12 6 Z" fill="#ffffff"/>
              <path d="M2 8 L4 8 L4 10 Z" fill="#808080"/>
              <path d="M2 8 L2 10 L4 10 Z" fill="#ffffff"/>
              <path d="M6 8 L8 8 L8 10 Z" fill="#808080"/>
              <path d="M6 8 L6 10 L8 10 Z" fill="#ffffff"/>
              <path d="M10 8 L12 8 L12 10 Z" fill="#808080"/>
              <path d="M10 8 L10 10 L12 10 Z" fill="#ffffff"/>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

// Desktop icon
const DesktopIcon95 = ({ icon, label, onClick, isSelected, onSelect, isMobile }) => {
  const iconContainerSize = isMobile ? 'w-12 h-12' : 'w-8 h-8';
  const containerWidth = isMobile ? 'w-20' : 'w-[70px]';
  const fontSize = isMobile ? 'text-xs' : 'text-[11px]';
  
  return (
    <button 
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
        // On mobile, single tap opens. On desktop, double-click opens.
        if (isMobile || e.detail === 2) onClick();
      }}
      className={`flex flex-col items-center gap-1 p-2 ${containerWidth}`}
      style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}
    >
      <div className={`${iconContainerSize} flex items-center justify-center ${isSelected ? 'brightness-75' : ''}`}>
        {icon}
      </div>
      <span 
        className={`${fontSize} text-center leading-tight px-0.5 ${isSelected ? 'bg-[#000080] text-white' : 'text-white'}`}
        style={{ textShadow: isSelected ? 'none' : '1px 1px 0 black' }}
      >
        {label}
      </span>
    </button>
  );
};

// Start Menu
const StartMenu95 = ({ apps, onAppClick, onClose, isMobile }) => {
  const menuBottom = isMobile ? 'bottom-14' : 'bottom-[30px]';
  const itemPadding = isMobile ? 'px-4 py-3' : 'px-3 py-1.5';
  const fontSize = isMobile ? 'text-sm' : 'text-xs';
  const menuWidth = isMobile ? 'flex-1' : 'w-48';
  
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute ${menuBottom} left-0 z-50 flex ${isMobile ? 'right-0 mx-2' : ''}`} style={{ backgroundColor: colors.gray, ...raised }}>
        {/* Windows 95 sidebar */}
        {!isMobile && (
          <div 
            className="w-[22px] flex items-end justify-center pb-1"
            style={{ 
              background: 'linear-gradient(to top, #808080 0%, #c0c0c0 100%)',
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)'
            }}
          >
            <span className="text-white font-bold text-sm tracking-wider" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', textShadow: '1px 1px 0 #404040' }}>
              Windows<span className="font-black">95</span>
            </span>
          </div>
        )}
      
        <div className={`${menuWidth} py-1`}>
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => { onAppClick(app.id); onClose(); }}
              className={`w-full flex items-center gap-3 ${itemPadding} hover:bg-[#000080] hover:text-white active:bg-[#000080] active:text-white text-left`}
              style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}
            >
              <span className={`${isMobile ? 'w-6' : 'w-5'} flex justify-center`}>{app.menuIcon}</span>
              <span className={fontSize}>{app.title}</span>
            </button>
          ))}
          
          <div className="border-t border-[#808080] border-b border-b-white my-1 mx-2" />
          
          {[
            { icon: <PixelIcon type="folder" size={isMobile ? 24 : 20} />, label: 'Documents', arrow: true },
            { icon: '⚙️', label: 'Settings', arrow: true },
            { icon: '🔍', label: 'Find', arrow: true },
            { icon: <PixelIcon type="help" size={isMobile ? 24 : 20} />, label: 'Help', arrow: false },
            { icon: '▶️', label: 'Run...', arrow: false },
          ].map((item, i) => (
            <button 
              key={i} 
              className={`w-full flex items-center gap-3 ${itemPadding} hover:bg-[#000080] hover:text-white active:bg-[#000080] active:text-white text-left`} 
              style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}
            >
              <span className={`${isMobile ? 'w-6' : 'w-5'} flex justify-center ${isMobile ? 'text-lg' : 'text-sm'}`}>{item.icon}</span>
              <span className={`${fontSize} flex-1`}>{item.label}</span>
              {item.arrow && <span className={fontSize}>▶</span>}
            </button>
          ))}
          
          <div className="border-t border-[#808080] border-b border-b-white my-1 mx-2" />
          
          <button 
            className={`w-full flex items-center gap-3 ${itemPadding} hover:bg-[#000080] hover:text-white active:bg-[#000080] active:text-white text-left`} 
            style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}
          >
            <span className={`${isMobile ? 'w-6' : 'w-5'} flex justify-center`}>🔌</span>
            <span className={fontSize}>Shut Down...</span>
          </button>
        </div>
      </div>
    </>
  );
};

// Taskbar
const Taskbar95 = ({ apps, windows, onAppClick, onStartClick, isStartOpen, isMobile }) => {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Mobile-friendly dimensions
  const taskbarHeight = isMobile ? 'h-14' : 'h-[30px]';
  const buttonHeight = isMobile ? 'h-10' : 'h-[22px]';
  const iconSize = isMobile ? 'w-6 h-6' : 'w-4 h-4';
  const fontSize = isMobile ? 'text-sm' : 'text-xs';
  
  return (
    <div className={`absolute bottom-0 left-0 right-0 ${taskbarHeight} flex items-center px-2 gap-2`} style={{ backgroundColor: colors.gray, ...raised }}>
      <Button95 onClick={onStartClick} active={isStartOpen} className={`flex items-center gap-2 ${buttonHeight} px-3`}>
        <svg viewBox="0 0 4 4" className={iconSize}>
          <rect x="0" y="0" width="1.8" height="1.8" fill="#ff0000"/>
          <rect x="2.2" y="0" width="1.8" height="1.8" fill="#00ff00"/>
          <rect x="0" y="2.2" width="1.8" height="1.8" fill="#0000ff"/>
          <rect x="2.2" y="2.2" width="1.8" height="1.8" fill="#ffff00"/>
        </svg>
        <span className={`${fontSize} font-bold`} style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>Start</span>
      </Button95>
      
      <div className={`w-px ${isMobile ? 'h-10' : 'h-6'} bg-[#808080] border-r border-white`} />
      
      <div className="flex-1 flex gap-1 overflow-hidden">
        {apps.filter(app => windows[app.id]?.isOpen).map((app) => (
          <button
            key={app.id}
            onClick={() => onAppClick(app.id)}
            className={`${buttonHeight} px-2 flex items-center gap-2 ${fontSize} ${isMobile ? 'min-w-[60px]' : 'min-w-[120px] max-w-[160px]'} truncate`}
            style={{ 
              backgroundColor: colors.gray,
              ...(windows[app.id]?.isMinimized ? raised : inset),
              fontFamily: '"MS Sans Serif", Tahoma, sans-serif'
            }}
          >
            <span className={`${isMobile ? 'w-5' : 'w-4'} shrink-0`}>{app.menuIcon}</span>
            {!isMobile && <span className="truncate">{app.title}</span>}
          </button>
        ))}
      </div>
      
      <div className={`${buttonHeight} px-3 flex items-center gap-2 ${fontSize}`} style={{ ...inset, fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}>
        <span>🔊</span>
        <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
};

// App Contents
const AboutContent = () => (
  <div className="p-3" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', fontSize: '11px' }}>
    <div className="flex gap-3 mb-3">
      <div className="w-12 h-12 flex items-center justify-center shrink-0" style={{ backgroundColor: colors.gray, ...raised }}>
        <PixelIcon type="user" size={40} />
      </div>
      <div>
        <h1 className="text-sm font-bold">Ryan Herrin</h1>
        <p className="text-[#000080] font-bold text-[11px]">Product Designer</p>
        <p className="mt-1 leading-relaxed">
          Crafting digital experiences that feel intuitive and delightful. 
          Passionate about design systems and making complex things simple.
        </p>
      </div>
    </div>
    
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2 mb-3">
      <legend className="px-1">System Properties</legend>
      <table className="w-full text-[11px]">
        <tbody>
          <tr><td className="py-px text-[#808080] w-24">Experience:</td><td className="py-px font-bold">5+ years</td></tr>
          <tr><td className="py-px text-[#808080]">Projects:</td><td className="py-px font-bold">40+ shipped</td></tr>
          <tr><td className="py-px text-[#808080]">Location:</td><td className="py-px font-bold">San Francisco, CA</td></tr>
          <tr><td className="py-px text-[#808080]">Status:</td><td className="py-px font-bold text-[#008000]">● Available</td></tr>
        </tbody>
      </table>
    </fieldset>
    
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2">
      <legend className="px-1">Installed Skills</legend>
      <div className="flex flex-wrap gap-1">
        {['Product Design', 'Figma', 'Design Systems', 'Prototyping', 'User Research', 'Interaction'].map((skill, i) => (
          <span key={i} className="px-2 py-px text-[11px]" style={{ backgroundColor: colors.gray, ...raised }}>
            {skill}
          </span>
        ))}
      </div>
    </fieldset>
  </div>
);

const ProjectsContent = () => (
  <div className="h-full flex flex-col" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', fontSize: '11px' }}>
    <div className="flex items-center gap-1 p-1 border-b border-[#808080]">
      <span className="px-1">📁</span>
      <span>C:\Portfolio\Case Studies</span>
    </div>
    
    <div className="flex-1 p-2 grid grid-cols-4 gap-3 content-start">
      {[
        { icon: <PixelIcon type="folder" size={32} />, name: 'Design System' },
        { icon: <PixelIcon type="folder" size={32} />, name: 'Mobile App' },
        { icon: <PixelIcon type="folder" size={32} />, name: 'Dashboard' },
        { icon: <PixelIcon type="folder" size={32} />, name: 'E-commerce' },
        { icon: <PixelIcon type="notepad" size={32} />, name: 'Resume.doc' },
        { icon: <PixelIcon type="user" size={32} />, name: 'Headshot.bmp' },
      ].map((item, i) => (
        <button key={i} className="flex flex-col items-center gap-0.5 p-1 hover:bg-[#000080] hover:text-white group w-16">
          <span>{item.icon}</span>
          <span className="text-[10px] text-center leading-tight">{item.name}</span>
        </button>
      ))}
    </div>
    
    <div className="px-2 py-1 border-t border-white text-[10px] text-[#808080]" style={{ borderTopColor: '#808080' }}>
      6 object(s)
    </div>
  </div>
);

const ContactContent = () => (
  <div className="p-3" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', fontSize: '11px' }}>
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2 mb-3">
      <legend className="px-1">✉️ Compose Message</legend>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <label className="w-12 text-right">To:</label>
          <input type="text" defaultValue="hello@ryanherrin.com" className="flex-1 px-1 py-px text-[11px]" style={{ ...inset, backgroundColor: 'white' }} readOnly />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-12 text-right">From:</label>
          <input type="text" placeholder="Your email" className="flex-1 px-1 py-px text-[11px]" style={{ ...inset, backgroundColor: 'white' }} />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-12 text-right">Subject:</label>
          <input type="text" placeholder="Let's work together!" className="flex-1 px-1 py-px text-[11px]" style={{ ...inset, backgroundColor: 'white' }} />
        </div>
        <div className="flex items-start gap-2">
          <label className="w-12 text-right pt-1">Message:</label>
          <textarea className="flex-1 px-1 py-px text-[11px] h-20 resize-none" style={{ ...inset, backgroundColor: 'white' }} placeholder="Type your message here..." />
        </div>
        <div className="flex justify-end gap-1 pt-1">
          <Button95 className="text-[11px] px-3">📤 Send</Button95>
          <Button95 className="text-[11px] px-3">Clear</Button95>
        </div>
      </div>
    </fieldset>
    
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2">
      <legend className="px-1">🔗 Quick Links</legend>
      <div className="space-y-0.5">
        <p>📧 <a href="#" className="text-[#0000ff] underline">hello@ryanherrin.com</a></p>
        <p>💼 <a href="#" className="text-[#0000ff] underline">linkedin.com/in/ryanherrin</a></p>
        <p>🐦 <a href="#" className="text-[#0000ff] underline">twitter.com/ryanherrin</a></p>
      </div>
    </fieldset>
  </div>
);

const TerminalContent = () => {
  const lines = [
    'Microsoft(R) Windows 95',
    '   (C)Copyright Microsoft Corp 1981-1995.',
    '',
    'C:\\RYAN>whoami',
    'RYAN_HERRIN - Product Designer',
    '',
    'C:\\RYAN>dir /skills',
    '',
    ' Volume in drive C is PORTFOLIO',
    ' Directory of C:\\RYAN\\SKILLS',
    '',
    'FIGMA    EXE     4,096  01-15-24',
    'SYSTEMS  DLL     8,192  01-15-24',
    'PROTO    EXE     2,048  01-15-24',
    'RESEARCH DLL     4,096  01-15-24',
    '',
    '        4 file(s)     18,432 bytes',
    '',
    'C:\\RYAN>echo %STATUS%',
    'Open to new opportunities!',
    '',
    'C:\\RYAN>_',
  ];
  
  return (
    <div className="h-full p-2 font-mono text-[12px] leading-[14px]" style={{ backgroundColor: '#000', color: '#c0c0c0' }}>
      {lines.map((line, i) => (
        <div key={i}>{line || '\u00A0'}</div>
      ))}
    </div>
  );
};

const NotepadContent = () => (
  <div className="h-full p-2 text-[12px] leading-relaxed whitespace-pre-wrap" style={{ fontFamily: 'Courier New, monospace' }}>
{`Welcome to my portfolio!
========================

Thanks for stopping by! I'm Ryan, a product 
designer who loves building things people 
actually enjoy using.

This portfolio is a design statement - 
understanding the history of interfaces 
makes you better at designing new ones.

Windows 95 was revolutionary:
• Invented the Start menu
• Created the taskbar  
• Established the desktop metaphor

30 years later, these concepts still work.

Feel free to explore!
• Double-click icons to open apps
• Drag corners to resize windows
• Windows snap to edges & each other!
• Try Minesweeper (I dare you)
• Clippy might have some tips 📎
• Yes, you can drag Clippy around!

Let's connect: hello@ryanherrin.com

- Ryan`}
  </div>
);

// Main component
export default function Windows95Portfolio() {
  const { isMobile, isTouch, layoutMode, inputMode } = useDeviceMode();
  const [isBooting, setIsBooting] = useState(true);
  const [showClippy, setShowClippy] = useState(false);
  const [windows, setWindows] = useState({
    about: { isOpen: true, isMinimized: false, isMaximized: false, position: { x: 60, y: 40 }, size: { width: 340, height: 340 }, zIndex: 2 },
    projects: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 140, y: 70 }, size: { width: 380, height: 300 }, zIndex: 0 },
    contact: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 180, y: 90 }, size: { width: 340, height: 360 }, zIndex: 0 },
    terminal: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 100, y: 100 }, size: { width: 440, height: 300 }, zIndex: 0 },
    notepad: { isOpen: true, isMinimized: false, isMaximized: false, position: { x: 380, y: 50 }, size: { width: 300, height: 360 }, zIndex: 1 },
    minesweeper: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 200, y: 60 }, size: { width: 200, height: 280 }, zIndex: 0 },
  });
  
  const [topZIndex, setTopZIndex] = useState(2);
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState(null);

  // On mobile, only show one window at boot (About Me)
  useEffect(() => {
    if (isMobile && !isBooting) {
      setWindows(prev => ({
        ...prev,
        notepad: { ...prev.notepad, isOpen: false }
      }));
    }
  }, [isMobile, isBooting]);

  useEffect(() => {
    if (!isBooting) {
      // Show Clippy after 2 seconds, but not on mobile
      if (!isMobile) {
        const timer = setTimeout(() => setShowClippy(true), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [isBooting, isMobile]);

  // Normalize z-indices if they get too high (prevents overflow)
  useEffect(() => {
    if (topZIndex > 1000) {
      const openWindows = Object.entries(windows)
        .filter(([_, w]) => w.isOpen)
        .sort((a, b) => a[1].zIndex - b[1].zIndex);
      
      let newZ = 1;
      const updates = {};
      openWindows.forEach(([id]) => {
        updates[id] = { ...windows[id], zIndex: newZ++ };
      });
      
      setWindows(prev => ({ ...prev, ...updates }));
      setTopZIndex(newZ);
    }
  }, [topZIndex]);

  // Mobile-friendly icon sizes
  const iconSize = isMobile ? 20 : 16;
  const desktopIconSize = isMobile ? 40 : 32;

  const apps = [
    { id: 'about', title: 'About Me', menuIcon: <PixelIcon type="user" size={iconSize} />, content: <AboutContent /> },
    { id: 'projects', title: 'My Projects', menuIcon: <PixelIcon type="folder" size={iconSize} />, content: <ProjectsContent /> },
    { id: 'contact', title: 'Contact', menuIcon: <PixelIcon type="mail" size={iconSize} />, content: <ContactContent /> },
    { id: 'terminal', title: 'MS-DOS Prompt', menuIcon: <PixelIcon type="terminal" size={iconSize} />, content: <TerminalContent /> },
    { id: 'notepad', title: 'README.txt - Notepad', menuIcon: <PixelIcon type="notepad" size={iconSize} />, content: <NotepadContent /> },
    { id: 'minesweeper', title: 'Minesweeper', menuIcon: <PixelIcon type="minesweeper" size={iconSize} />, content: <Minesweeper />, hideMenuBar: true },
  ];

  const desktopIcons = [
    { id: 'about', label: 'About Me', icon: <PixelIcon type="user" size={desktopIconSize} /> },
    { id: 'projects', label: 'My Projects', icon: <PixelIcon type="folder" size={desktopIconSize} /> },
    { id: 'contact', label: 'Contact', icon: <PixelIcon type="mail" size={desktopIconSize} /> },
    { id: 'terminal', label: 'MS-DOS', icon: <PixelIcon type="terminal" size={desktopIconSize} /> },
    { id: 'notepad', label: 'README', icon: <PixelIcon type="notepad" size={desktopIconSize} /> },
    { id: 'minesweeper', label: 'Minesweeper', icon: <PixelIcon type="minesweeper" size={desktopIconSize} /> },
    { id: 'recycle', label: 'Recycle Bin', icon: <PixelIcon type="recycle" size={desktopIconSize} /> },
  ];

  const bringToFront = (id) => {
    const newZ = topZIndex + 1;
    setTopZIndex(newZ);
    setWindows(prev => ({ ...prev, [id]: { ...prev[id], zIndex: newZ } }));
  };

  const openApp = (id) => {
    if (id === 'recycle') return;
    
    // On mobile, close other windows when opening a new one (single window mode)
    if (isMobile) {
      const updatedWindows = {};
      Object.keys(windows).forEach(winId => {
        updatedWindows[winId] = { 
          ...windows[winId], 
          isOpen: winId === id,
          isMinimized: false 
        };
      });
      updatedWindows[id].zIndex = topZIndex + 1;
      setTopZIndex(topZIndex + 1);
      setWindows(updatedWindows);
    } else {
      bringToFront(id);
      setWindows(prev => ({ ...prev, [id]: { ...prev[id], isOpen: true, isMinimized: false } }));
    }
  };

  const closeWindow = (id) => {
    setWindows(prev => ({ ...prev, [id]: { ...prev[id], isOpen: false, isMaximized: false } }));
  };

  const minimizeWindow = (id) => {
    setWindows(prev => ({ ...prev, [id]: { ...prev[id], isMinimized: true } }));
  };

  const maximizeWindow = (id) => {
    setWindows(prev => ({ ...prev, [id]: { ...prev[id], isMaximized: !prev[id].isMaximized } }));
  };

  const handleDrag = (id, position) => {
    if (isMobile) return; // No dragging on mobile
    setWindows(prev => ({ ...prev, [id]: { ...prev[id], position } }));
  };

  const handleResize = (id, size) => {
    if (isMobile) return; // No resizing on mobile
    setWindows(prev => ({ ...prev, [id]: { ...prev[id], size } }));
  };

  const handleTaskbarClick = (id) => {
    if (isMobile) {
      // On mobile, just open the app (single window mode)
      openApp(id);
    } else {
      if (windows[id]?.isMinimized) {
        openApp(id);
      } else if (windows[id]?.zIndex === topZIndex) {
        minimizeWindow(id);
      } else {
        bringToFront(id);
      }
    }
  };

  if (isBooting) {
    return <BootScreen onComplete={() => setIsBooting(false)} />;
  }

  return (
    <div 
      className="w-full h-screen relative overflow-hidden select-none"
      style={{ backgroundColor: '#008080' }}
      onClick={() => { setSelectedIcon(null); setIsStartOpen(false); }}
    >
      {/* Desktop icons - hidden on mobile when a window is open */}
      {(!isMobile || !Object.values(windows).some(w => w.isOpen && !w.isMinimized)) && (
        <div 
          className={`absolute top-2 left-2 flex ${isMobile ? 'flex-row flex-wrap gap-2' : 'flex-col gap-1'}`} 
          onClick={(e) => e.stopPropagation()}
        >
          {desktopIcons.map((item) => (
            <DesktopIcon95
              key={item.id}
              icon={item.icon}
              label={item.label}
              isSelected={selectedIcon === item.id}
              onSelect={() => setSelectedIcon(item.id)}
              onClick={() => openApp(item.id)}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}
      
      {/* Windows */}
      {apps.map((app) => (
        windows[app.id]?.isOpen && (
          <Window95
            key={app.id}
            id={app.id}
            title={app.title}
            icon={app.menuIcon}
            position={windows[app.id].position}
            size={windows[app.id].size}
            zIndex={windows[app.id].zIndex}
            isMinimized={windows[app.id].isMinimized}
            isMaximized={windows[app.id].isMaximized}
            onClose={closeWindow}
            onMinimize={minimizeWindow}
            onMaximize={maximizeWindow}
            onFocus={bringToFront}
            onDrag={handleDrag}
            onResize={handleResize}
            hideMenuBar={app.hideMenuBar}
            allWindows={windows}
            isMobile={isMobile}
            isTouch={isTouch}
          >
            {app.content}
          </Window95>
        )
      ))}
      
      {/* Clippy - hidden on mobile */}
      {showClippy && !isMobile && <Clippy onClose={() => setShowClippy(false)} />}
      
      {/* Start Menu */}
      {isStartOpen && (
        <StartMenu95 
          apps={apps} 
          onAppClick={openApp} 
          onClose={() => setIsStartOpen(false)} 
          isMobile={isMobile}
        />
      )}
      
      {/* Taskbar */}
      <Taskbar95 
        apps={apps}
        windows={windows}
        onAppClick={handleTaskbarClick}
        onStartClick={(e) => { e.stopPropagation(); setIsStartOpen(!isStartOpen); }}
        isStartOpen={isStartOpen}
        isMobile={isMobile}
      />
    </div>
  );
}
