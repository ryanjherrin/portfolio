// @ts-nocheck
'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAudioStore, Track } from '@/lib/stores/audioStore';
import { useAudioEngine } from '@/lib/audioEngine';

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
const SNAP_DISTANCE = 12; // pixels - how close before snapping kicks in

// Desktop icon grid configuration
const DESKTOP_GRID = {
  cellWidth: 80,      // Width per grid cell
  cellHeight: 90,     // Height per grid cell  
  padding: 8,         // Padding from edges
};

// Hook to calculate desktop grid dimensions based on viewport
const useDesktopGrid = (isMobile: boolean) => {
  const taskbarHeight = isMobile ? 56 : 30;
  const [gridSize, setGridSize] = useState({ cols: 0, rows: 0 });

  useEffect(() => {
    const updateGrid = () => {
      const availableHeight = window.innerHeight - taskbarHeight - DESKTOP_GRID.padding * 2;
      const availableWidth = window.innerWidth - DESKTOP_GRID.padding * 2;
      setGridSize({
        cols: Math.max(1, Math.floor(availableWidth / DESKTOP_GRID.cellWidth)),
        rows: Math.max(1, Math.floor(availableHeight / DESKTOP_GRID.cellHeight)),
      });
    };

    updateGrid();
    window.addEventListener('resize', updateGrid);
    return () => window.removeEventListener('resize', updateGrid);
  }, [taskbarHeight]);

  const cellToPixels = (col: number, row: number) => ({
    x: DESKTOP_GRID.padding + col * DESKTOP_GRID.cellWidth,
    y: DESKTOP_GRID.padding + row * DESKTOP_GRID.cellHeight,
  });

  const pixelsToCell = (x: number, y: number) => ({
    col: Math.max(0, Math.min(gridSize.cols - 1, Math.floor((x - DESKTOP_GRID.padding) / DESKTOP_GRID.cellWidth))),
    row: Math.max(0, Math.min(gridSize.rows - 1, Math.floor((y - DESKTOP_GRID.padding) / DESKTOP_GRID.cellHeight))),
  });

  return { gridSize, taskbarHeight, cellToPixels, pixelsToCell };
};

// Type definitions for window snapping
type WindowSize = { width: number; height: number };
type Viewport = { width: number; height: number };
type WindowState = {
  isOpen: boolean;
  isMinimized: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
};
type WindowsMap = Record<string, WindowState>;

// Snap to screen edges
const snapToScreen = (nextX: number, nextY: number, win: WindowSize, viewport: Viewport) => {
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
const snapToWindows = (nextX: number, nextY: number, win: WindowSize, allWindows: WindowsMap, currentId: string) => {
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
const getSnappedPosition = (nextX: number, nextY: number, win: WindowSize, allWindows: WindowsMap, currentId: string, viewport: Viewport) => {
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

// Windows XP Luna color palette
const colorsXP = {
  bg: '#3a6ea5',  // XP bliss blue (will be replaced by wallpaper)
  desktopBg: 'linear-gradient(to bottom, #245EDC 0%, #3A6EA5 100%)',
  taskbar: 'linear-gradient(to bottom, #3168d5 0%, #4993E6 2%, #2157D7 3%, #2663E0 50%, #1941A5 51%, #1941A5 100%)',
  taskbarBorder: '#0A246A',
  startBtnGreen: 'linear-gradient(to bottom, #5ABA47 0%, #3C8D2F 50%, #349E27 51%, #3DB634 100%)',
  startBtnGreenHover: 'linear-gradient(to bottom, #6FD35E 0%, #4CA63F 50%, #44B737 51%, #4DC944 100%)',
  startBtnGreenActive: 'linear-gradient(to bottom, #4A9A3A 0%, #2F7A25 50%, #29891E 51%, #32A12A 100%)',
  windowTitleActive: 'linear-gradient(to bottom, #0A246A 0%, #0F52C5 8%, #0F5DD9 40%, #266ADA 88%, #0A246A 93%, #0A246A 100%)',
  windowTitleInactive: 'linear-gradient(to bottom, #7C96C8 0%, #8EAAD9 8%, #92B0DD 40%, #A8C4E8 88%, #7C96C8 93%, #7C96C8 100%)',
  windowBg: '#ECE9D8',
  windowBorder: '#0054E3',
  buttonFace: '#ECE9D8',
  buttonHighlight: '#FFFFFF',
  buttonShadow: '#ACA899',
  white: '#ffffff',
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

// XP style borders (softer, more rounded look)
const raisedXP = {
  borderTop: `1px solid ${colorsXP.buttonHighlight}`,
  borderLeft: `1px solid ${colorsXP.buttonHighlight}`,
  borderBottom: `1px solid ${colorsXP.buttonShadow}`,
  borderRight: `1px solid ${colorsXP.buttonShadow}`,
};

const insetXP = {
  borderTop: `1px solid ${colorsXP.buttonShadow}`,
  borderLeft: `1px solid ${colorsXP.buttonShadow}`,
  borderBottom: `1px solid ${colorsXP.buttonHighlight}`,
  borderRight: `1px solid ${colorsXP.buttonHighlight}`,
};

// Pixel Art Icons - Using authentic Windows 95/98 .ico files
const PixelIcon = ({ type, size = 32 }) => {
  const iconStyle = { imageRendering: 'pixelated' as const };
  const icons = {
    computer: <img src="/icons/w95-computer.ico" width={size} height={size} alt="Computer" style={iconStyle} />,
    folder: <img src="/icons/w95-folder.ico" width={size} height={size} alt="Folder" style={iconStyle} />,
    notepad: <img src="/icons/w95-notepad.ico" width={size} height={size} alt="Notepad" style={iconStyle} />,
    mail: <img src="/icons/w95-mail.ico" width={size} height={size} alt="Mail" style={iconStyle} />,
    terminal: <img src="/icons/w95-terminal.ico" width={size} height={size} alt="Terminal" style={iconStyle} />,
    user: <img src="/icons/w95-user.ico" width={size} height={size} alt="User" style={iconStyle} />,
    recycle: <img src="/icons/w95-recycle.ico" width={size} height={size} alt="Recycle Bin" style={iconStyle} />,
    minesweeper: <img src="/icons/w95-minesweeper.ico" width={size} height={size} alt="Minesweeper" style={iconStyle} />,
    help: <img src="/icons/w95-help.ico" width={size} height={size} alt="Help" style={iconStyle} />,
    paint: <img src="/icons/w95-paint.ico" width={size} height={size} alt="Paint" style={iconStyle} />,
    media: <img src="/icons/w95-media.ico" width={size} height={size} alt="Media Player" style={iconStyle} />,
  };
  return icons[type] || icons.folder;
};

// Windows XP Style Icons - Using authentic Windows XP .ico files
const XPIcon = ({ type, size = 32 }) => {
  const icons = {
    computer: <img src="/icons/wxp-computer.ico" width={size} height={size} alt="Computer" />,
    folder: <img src="/icons/wxp-folder.ico" width={size} height={size} alt="Folder" />,
    notepad: <img src="/icons/wxp-notepad.ico" width={size} height={size} alt="Notepad" />,
    mail: <img src="/icons/wxp-mail.ico" width={size} height={size} alt="Mail" />,
    terminal: <img src="/icons/wxp-terminal.png" width={size} height={size} alt="Terminal" />,
    user: <img src="/icons/wxp-user.ico" width={size} height={size} alt="User" />,
    recycle: <img src="/icons/wxp-recycle.ico" width={size} height={size} alt="Recycle Bin" />,
    minesweeper: <img src="/icons/wxp-minesweeper.png" width={size} height={size} alt="Minesweeper" />,
    help: <img src="/icons/wxp-help.ico" width={size} height={size} alt="Help" />,
    paint: <img src="/icons/wxp-paint.ico" width={size} height={size} alt="Paint" />,
    media: <img src="/icons/wxp-media.ico" width={size} height={size} alt="Media Player" />,
  };
  return icons[type] || icons.folder;
};

// Windows 95 Startup Sound
const playStartupSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
  
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
  } catch (e) {
    // Audio playback failed, continue silently
    console.warn('Startup sound failed:', e);
  }
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
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-9999">
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
  const [position, setPosition] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 280 : 500, y: 80 });
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
      className="fixed z-100 flex flex-col items-end gap-2"
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
          color: colors.black,
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
const Minesweeper = ({ currentOS = 'win95', onResize }: { currentOS?: string, onResize?: (width: number, height: number) => void }) => {
  const [grid, setGrid] = useState<Array<Array<{isMine: boolean, isRevealed: boolean, isFlagged: boolean, neighborMines: number}>>>([]);
  const [gameState, setGameState] = useState('playing');
  const [flagCount, setFlagCount] = useState(0);
  const [difficulty, setDifficulty] = useState('beginner');
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [settings, setSettings] = useState({ marks: true, color: true, sound: true });
  
  // Difficulty settings - authentic XP sizes
  const difficulties = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
  };
  
  const { rows: ROWS, cols: COLS, mines: MINES } = difficulties[difficulty];
  const CELL_SIZE = 16; // Authentic XP cell size
  
  // Calculate window size based on grid dimensions
  // Width: grid + borders (6px) + padding (8px)
  // Height: title bar (26px) + menu bar (20px) + control panel (42px) + grid + borders + padding
  useEffect(() => {
    if (onResize) {
      const gridWidth = COLS * CELL_SIZE;
      const gridHeight = ROWS * CELL_SIZE;
      const windowWidth = gridWidth + 22;
      const windowHeight = gridHeight + 120;
      onResize(windowWidth, windowHeight);
    }
  }, [difficulty, COLS, ROWS, onResize]);

  // OS-specific styling
  const isXP = currentOS === 'winxp';
  const bgColor = isXP ? colorsXP.windowBg : colors.gray;
  const borderStyle = isXP ? insetXP : inset;
  const buttonBorder = isXP ? raisedXP : raised;
  const fontFamily = isXP ? 'Tahoma, sans-serif' : '"MS Sans Serif", Tahoma, sans-serif';

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
  }, [ROWS, COLS, MINES]);

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

  // XP-specific cell styling - matches authentic XP Minesweeper exactly
  const getCellStyle = (cell) => {
    if (cell.isRevealed) {
      // Revealed cells are flat with single pixel border creating grid lines
      return { 
        backgroundColor: '#C0C0C0', 
        borderRight: '1px solid #808080',
        borderBottom: '1px solid #808080',
        borderTop: 'none',
        borderLeft: 'none',
      };
    }
    // Unrevealed cells have raised 3D look - white/light on top-left, dark on bottom-right
    return { 
      backgroundColor: '#C0C0C0',
      borderTop: '2px solid #ffffff',
      borderLeft: '2px solid #ffffff', 
      borderBottom: '2px solid #808080',
      borderRight: '2px solid #808080',
    };
  };

  // LED Display component for mine counter and timer
  const LEDDisplay = ({ value }: { value: number }) => (
    <div 
      style={{ 
        backgroundColor: '#300', 
        padding: '2px 4px',
        border: '1px solid #000',
        borderRadius: isXP ? '2px' : '0',
        boxShadow: 'inset 1px 1px 2px rgba(0,0,0,0.8)',
      }}
    >
      <span style={{
        fontFamily: '"Digital-7", "Courier New", monospace',
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#f00',
        textShadow: '0 0 4px #f00',
        letterSpacing: '2px',
      }}>
        {String(Math.max(0, Math.min(999, value))).padStart(3, '0')}
      </span>
    </div>
  );

  const handleDifficultyChange = (newDifficulty) => {
    setDifficulty(newDifficulty);
    setShowGameMenu(false);
  };

  const toggleSetting = (setting) => {
    setSettings(prev => ({ ...prev, [setting]: !prev[setting] }));
  };

  const closeMenus = () => {
    setShowGameMenu(false);
    setShowHelpMenu(false);
  };

  // Calculate grid dimensions
  const gridWidth = COLS * CELL_SIZE;
  const gridHeight = ROWS * CELL_SIZE;

  return (
    <div 
      className="select-none" 
      style={{ 
        fontFamily, 
        fontSize: '12px', 
        backgroundColor: '#C0C0C0',
      }}
      onClick={(e) => {
        // Close menus when clicking outside
        if (!(e.target as HTMLElement).closest('.menu-item')) {
          closeMenus();
        }
      }}
    >
      {/* Menu bar - fixed at top, never scrolls */}
      <div style={{ 
        backgroundColor: '#ECE9D8',
        borderBottom: '1px solid #808080',
        position: 'relative',
      }}>
        <span 
          className="menu-item"
          style={{ 
            padding: '2px 8px', 
            cursor: 'pointer',
            backgroundColor: showGameMenu ? '#316AC5' : 'transparent',
            color: showGameMenu ? '#fff' : '#000',
            display: 'inline-block',
          }}
          onClick={(e) => { e.stopPropagation(); setShowGameMenu(!showGameMenu); setShowHelpMenu(false); }}
        >
          Game
        </span>
        <span 
          className="menu-item"
          style={{ 
            padding: '2px 8px', 
            cursor: 'pointer',
            backgroundColor: showHelpMenu ? '#316AC5' : 'transparent',
            color: showHelpMenu ? '#fff' : '#000',
            display: 'inline-block',
          }}
          onClick={(e) => { e.stopPropagation(); setShowHelpMenu(!showHelpMenu); setShowGameMenu(false); }}
        >
          Help
        </span>
        
        {/* Game dropdown menu */}
        {showGameMenu && (
          <div 
            className="menu-item"
            style={{
              position: 'absolute',
              top: '100%',
              left: '0',
              backgroundColor: '#fff',
              border: '1px solid #808080',
              boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
              zIndex: 1000,
              minWidth: '160px',
            }}
          >
            <div 
              className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer flex justify-between"
              onClick={() => { initGame(); closeMenus(); }}
            >
              <span>New</span>
              <span style={{ color: '#808080' }}>F2</span>
            </div>
            <div style={{ borderTop: '1px solid #C0C0C0', margin: '2px 2px' }} />
            <div 
              className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer"
              onClick={() => handleDifficultyChange('beginner')}
            >
              {difficulty === 'beginner' ? '✓ ' : '   '}Beginner
            </div>
            <div 
              className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer"
              onClick={() => handleDifficultyChange('intermediate')}
            >
              {difficulty === 'intermediate' ? '✓ ' : '   '}Intermediate
            </div>
            <div 
              className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer"
              onClick={() => handleDifficultyChange('expert')}
            >
              {difficulty === 'expert' ? '✓ ' : '   '}Expert
            </div>
            <div className="px-6 py-1 text-gray-400 cursor-default">
              {'   '}Custom...
            </div>
            <div style={{ borderTop: '1px solid #C0C0C0', margin: '2px 2px' }} />
            <div 
              className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer"
              onClick={() => toggleSetting('marks')}
            >
              {settings.marks ? '✓ ' : '   '}Marks (?)
            </div>
            <div 
              className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer"
              onClick={() => toggleSetting('color')}
            >
              {settings.color ? '✓ ' : '   '}Color
            </div>
            <div 
              className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer"
              onClick={() => toggleSetting('sound')}
            >
              {settings.sound ? '✓ ' : '   '}Sound
            </div>
            <div style={{ borderTop: '1px solid #C0C0C0', margin: '2px 2px' }} />
            <div className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer">
              {'   '}Best Times...
            </div>
            <div style={{ borderTop: '1px solid #C0C0C0', margin: '2px 2px' }} />
            <div className="px-6 py-1 hover:bg-[#316AC5] hover:text-white cursor-pointer">
              {'   '}Exit
            </div>
          </div>
        )}
      </div>
      
      {/* Main game area with padding */}
      <div style={{ padding: '4px' }}>
        {/* Control panel - sunken border */}
        <div 
          className="flex items-center justify-between"
          style={{ 
            padding: '4px 5px',
            marginBottom: '4px',
            borderTop: '2px solid #808080',
            borderLeft: '2px solid #808080',
            borderBottom: '2px solid #ffffff',
            borderRight: '2px solid #ffffff',
            backgroundColor: '#C0C0C0',
          }}
        >
          <LEDDisplay value={MINES - flagCount} />
          <button 
            onClick={initGame} 
            className="flex items-center justify-center"
            style={{ 
              width: '26px',
              height: '26px',
              backgroundColor: '#C0C0C0',
              borderTop: '2px solid #ffffff',
              borderLeft: '2px solid #ffffff',
              borderBottom: '2px solid #808080',
              borderRight: '2px solid #808080',
              fontSize: '16px',
              cursor: 'pointer',
            }}
          >
            {faceEmoji}
          </button>
          <LEDDisplay value={0} />
        </div>
        
        {/* Game grid - sunken border */}
        <div 
          style={{ 
            borderTop: '3px solid #808080',
            borderLeft: '3px solid #808080',
            borderBottom: '3px solid #ffffff',
            borderRight: '3px solid #ffffff',
            lineHeight: 0,
          }}
        >
          {grid.map((row, r) => (
            <div key={r} style={{ display: 'flex' }}>
              {row.map((cell, c) => (
                <button
                  key={c}
                  onClick={() => revealCell(r, c)}
                  onContextMenu={(e) => toggleFlag(e, r, c)}
                  style={{
                    width: `${CELL_SIZE}px`,
                    height: `${CELL_SIZE}px`,
                    ...getCellStyle(cell),
                    color: getNumberColor(cell.neighborMines),
                    boxSizing: 'border-box',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    padding: 0,
                    margin: 0,
                    cursor: 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Arial, sans-serif',
                  }}
                >
                  {getCellContent(cell)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      
      {gameState !== 'playing' && (
        <div style={{ 
          padding: '4px', 
          textAlign: 'center', 
          fontWeight: 'bold',
          backgroundColor: '#C0C0C0',
        }}>
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
        color: colors.black,
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
const Window95 = ({ id, title, icon, children, position, size, zIndex, isMinimized, isMaximized, onClose, onMinimize, onMaximize, onFocus, onDrag, onResize, hideMenuBar, noScroll, noStatusBar, minWidth = 200, minHeight = 150, allWindows, isMobile, isTouch }) => {
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
        <div className="h-6 flex items-center px-1 text-xs" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', color: colors.black }}>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>F</u>ile</span>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>E</u>dit</span>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>V</u>iew</span>
          <span className="px-2 hover:bg-[#000080] hover:text-white cursor-pointer"><u>H</u>elp</span>
        </div>
      )}
      
      {/* Content */}
      <div className={`flex-1 ${noScroll ? 'overflow-hidden' : 'overflow-auto'} ${noScroll ? '' : 'm-0.5'}`} style={{ ...(noScroll ? {} : inset), backgroundColor: noScroll ? 'transparent' : colors.white, color: colors.black }}>
        {children}
      </div>
      
      {/* Status bar with resize grip */}
      {!noStatusBar && (
      <div className={`${isMobile ? 'h-8' : 'h-6'} flex items-center px-1 ${isMobile ? 'text-sm' : 'text-xs'} shrink-0`} style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', color: colors.black }}>
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
      )}
    </div>
  );
};

// Windows XP Window
const WindowXP = ({ id, title, icon, children, position, size, zIndex, isMinimized, isMaximized, onClose, onMinimize, onMaximize, onFocus, onDrag, onResize, hideMenuBar, noScroll, noStatusBar, minWidth = 200, minHeight = 150, allWindows, isMobile, isTouch }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });
  const animationFrameRef = useRef(null);

  const effectivelyMaximized = isMobile || isMaximized;

  const handleDragMouseDown = (e) => {
    if (isMobile) return;
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
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      const nextX = e.clientX - dragOffset.current.x;
      const nextY = e.clientY - dragOffset.current.y;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const snapped = getSnappedPosition(nextX, nextY, size, allWindows, id, viewport);
      onDrag(id, snapped);
    });
  }, [isDragging, id, onDrag, size, allWindows, isMobile]);

  const handleDragMouseUp = () => {
    setIsDragging(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  };

  const handleResizeMouseDown = (e, direction) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    if (isMaximized) return;
    onFocus(id);
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStart.current = {
      x: e.clientX, y: e.clientY,
      width: size.width, height: size.height,
      posX: position.x, posY: position.y
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
    if (resizeDirection.includes('e')) newWidth = Math.max(minWidth, resizeStart.current.width + deltaX);
    if (resizeDirection.includes('w')) {
      const proposedWidth = resizeStart.current.width - deltaX;
      if (proposedWidth >= minWidth) { newWidth = proposedWidth; newX = resizeStart.current.posX + deltaX; }
    }
    if (resizeDirection.includes('s')) newHeight = Math.max(minHeight, resizeStart.current.height + deltaY);
    if (resizeDirection.includes('n')) {
      const proposedHeight = resizeStart.current.height - deltaY;
      if (proposedHeight >= minHeight) { newHeight = proposedHeight; newY = resizeStart.current.posY + deltaY; }
    }
    onResize(id, { width: newWidth, height: newHeight });
    if (newX !== position.x || newY !== position.y) onDrag(id, { x: newX, y: newY });
  }, [isResizing, resizeDirection, id, onResize, onDrag, minWidth, minHeight, position.x, position.y]);

  const handleResizeMouseUp = () => { setIsResizing(false); setResizeDirection(null); };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMouseMove);
      window.addEventListener('mouseup', handleDragMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleDragMouseMove);
        window.removeEventListener('mouseup', handleDragMouseUp);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
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

  const taskbarHeight = isMobile ? 56 : 30;
  const windowStyle = effectivelyMaximized 
    ? { top: 0, left: 0, width: '100%', height: `calc(100% - ${taskbarHeight}px)`, zIndex }
    : { top: position.y, left: position.x, width: size.width, height: size.height, zIndex };

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

  const titleBarHeight = isMobile ? 'h-10' : 'h-7';
  const buttonSize = isMobile ? 22 : 21;

  return (
    <div
      className="absolute flex flex-col rounded-t-lg overflow-hidden"
      style={{
        ...windowStyle,
        backgroundColor: colorsXP.windowBg,
        border: '1px solid #0054E3',
        boxShadow: '2px 2px 8px rgba(0,0,0,0.3)',
      }}
      onMouseDown={() => onFocus(id)}
    >
      {!effectivelyMaximized && !isMobile && resizeHandles.map(({ dir, className }) => (
        <div key={dir} className={className} onMouseDown={(e) => handleResizeMouseDown(e, dir)} />
      ))}

      {/* XP Title bar */}
      <div 
        className={`${titleBarHeight} flex items-center px-2 gap-2 select-none shrink-0 rounded-t-lg`}
        style={{ 
          background: colorsXP.windowTitleActive,
          touchAction: 'none'
        }}
        onMouseDown={handleDragMouseDown}
      >
        <div className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} flex items-center justify-center shrink-0`}>{icon}</div>
        <span className={`text-white ${isMobile ? 'text-sm' : 'text-xs'} font-bold flex-1 truncate`} style={{ fontFamily: 'Trebuchet MS, Tahoma, sans-serif', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
          {title}
        </span>
        
        <div className="window-controls flex gap-0.5">
          {/* XP window buttons */}
          {!isMobile && (
            <button 
              onClick={() => onMinimize(id)} 
              className="flex items-center justify-center rounded-sm transition-all"
              style={{ 
                width: buttonSize, height: buttonSize,
                background: 'linear-gradient(to bottom, #3C81F3 0%, #2B71E1 45%, #1C5FC8 46%, #1856B0 100%)',
                border: '1px solid #2456B0',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 9 9">
                <rect x="1" y="6" width="7" height="2" fill="white"/>
              </svg>
            </button>
          )}
          {!isMobile && (
            <button 
              onClick={() => onMaximize(id)} 
              className="flex items-center justify-center rounded-sm transition-all"
              style={{ 
                width: buttonSize, height: buttonSize,
                background: 'linear-gradient(to bottom, #3C81F3 0%, #2B71E1 45%, #1C5FC8 46%, #1856B0 100%)',
                border: '1px solid #2456B0',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 9 9">
                <rect x="1" y="1" width="7" height="7" fill="none" stroke="white" strokeWidth="1"/>
                <rect x="1" y="1" width="7" height="2" fill="white"/>
              </svg>
            </button>
          )}
          <button 
            onClick={() => onClose(id)} 
            className="flex items-center justify-center rounded-sm transition-all"
            style={{ 
              width: buttonSize, height: buttonSize,
              background: 'linear-gradient(to bottom, #C33A32 0%, #B12A23 45%, #A01F19 46%, #8B1712 100%)',
              border: '1px solid #6B1510',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9">
              <path d="M1 1 L8 8 M8 1 L1 8" stroke="white" strokeWidth="1.5"/>
            </svg>
          </button>
        </div>
      </div>
      
      {/* Menu bar */}
      {!hideMenuBar && (
        <div className="h-6 flex items-center px-1 text-xs border-b" style={{ fontFamily: 'Tahoma, sans-serif', color: colorsXP.black, backgroundColor: colorsXP.windowBg, borderColor: '#ACA899' }}>
          <span className="px-2 hover:bg-[#316AC5] hover:text-white cursor-pointer rounded"><u>F</u>ile</span>
          <span className="px-2 hover:bg-[#316AC5] hover:text-white cursor-pointer rounded"><u>E</u>dit</span>
          <span className="px-2 hover:bg-[#316AC5] hover:text-white cursor-pointer rounded"><u>V</u>iew</span>
          <span className="px-2 hover:bg-[#316AC5] hover:text-white cursor-pointer rounded"><u>H</u>elp</span>
        </div>
      )}
      
      {/* Content */}
      <div className={`flex-1 ${noScroll ? 'overflow-hidden' : 'overflow-auto'}`} style={{ backgroundColor: noScroll ? 'transparent' : colorsXP.white, color: colorsXP.black, border: noScroll ? 'none' : '1px solid #ACA899', margin: noScroll ? '0' : '2px' }}>
        {children}
      </div>
      
      {/* Status bar */}
      {!noStatusBar && (
      <div className={`${isMobile ? 'h-7' : 'h-5'} flex items-center px-1 ${isMobile ? 'text-sm' : 'text-xs'} shrink-0`} style={{ fontFamily: 'Tahoma, sans-serif', color: colorsXP.black, backgroundColor: colorsXP.windowBg }}>
        <div className="flex-1 px-2 h-4 flex items-center rounded" style={{ ...insetXP, backgroundColor: '#F1EFE2' }}>Ready</div>
        {!effectivelyMaximized && !isMobile && (
          <div 
            className="w-4 h-4 cursor-se-resize flex items-end justify-end ml-1"
            onMouseDown={(e) => handleResizeMouseDown(e, 'se')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <circle cx="10" cy="2" r="1.5" fill="#ACA899"/>
              <circle cx="6" cy="6" r="1.5" fill="#ACA899"/>
              <circle cx="10" cy="6" r="1.5" fill="#ACA899"/>
              <circle cx="2" cy="10" r="1.5" fill="#ACA899"/>
              <circle cx="6" cy="10" r="1.5" fill="#ACA899"/>
              <circle cx="10" cy="10" r="1.5" fill="#ACA899"/>
            </svg>
          </div>
        )}
      </div>
      )}
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

// Windows XP Desktop icon
const DesktopIconXP = ({ icon, label, onClick, isSelected, onSelect, isMobile }) => {
  const iconContainerSize = isMobile ? 'w-14 h-14' : 'w-12 h-12';
  const containerWidth = isMobile ? 'w-20' : 'w-[75px]';
  const fontSize = isMobile ? 'text-xs' : 'text-[11px]';
  
  return (
    <button 
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
        if (isMobile || e.detail === 2) onClick();
      }}
      className={`flex flex-col items-center gap-1 p-2 ${containerWidth} rounded transition-all`}
      style={{ 
        fontFamily: 'Tahoma, sans-serif',
        background: isSelected 
          ? 'linear-gradient(to bottom, rgba(49,106,197,0.4) 0%, rgba(49,106,197,0.25) 100%)' 
          : 'transparent',
        border: isSelected ? '1px dotted rgba(49,106,197,0.8)' : '1px solid transparent',
      }}
    >
      <div 
        className={`${iconContainerSize} flex items-center justify-center rounded`}
        style={{
          filter: isSelected ? 'drop-shadow(0 0 3px rgba(49,106,197,0.8))' : 'drop-shadow(1px 2px 2px rgba(0,0,0,0.3))',
        }}
      >
        {icon}
      </div>
      <span 
        className={`${fontSize} text-center leading-tight px-1 py-0.5 rounded`}
        style={{ 
          color: 'white',
          textShadow: '1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8)',
          backgroundColor: isSelected ? 'rgba(49,106,197,0.7)' : 'transparent',
        }}
      >
        {label}
      </span>
    </button>
  );
};

// Draggable wrapper for desktop icons
const DraggableDesktopIcon = ({ 
  iconId,
  position, 
  gridSize, 
  onDragEnd, 
  children, 
  isMobile,
  cellToPixels,
  pixelsToCell,
  isCellOccupied,
}: {
  iconId: string;
  position: { col: number; row: number };
  gridSize: { cols: number; rows: number };
  onDragEnd: (newPos: { col: number; row: number }) => void;
  children: React.ReactNode;
  isMobile: boolean;
  cellToPixels: (col: number, row: number) => { x: number; y: number };
  pixelsToCell: (x: number, y: number) => { col: number; row: number };
  isCellOccupied: (col: number, row: number, excludeId: string) => boolean;
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const hasDraggedRef = useRef(false);

  // Convert grid position to pixels
  const pixelPos = cellToPixels(position.col, position.row);

  const handleDragStart = (clientX: number, clientY: number) => {
    dragStartRef.current = {
      x: clientX,
      y: clientY,
      startX: pixelPos.x,
      startY: pixelPos.y,
    };
    setDragPos({ x: pixelPos.x, y: pixelPos.y });
    setIsDragging(true);
    hasDraggedRef.current = false;
  };

  const handleDragMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    
    const deltaX = clientX - dragStartRef.current.x;
    const deltaY = clientY - dragStartRef.current.y;
    
    // Mark as dragged if moved more than 5 pixels
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      hasDraggedRef.current = true;
    }
    
    setDragPos({
      x: dragStartRef.current.startX + deltaX,
      y: dragStartRef.current.startY + deltaY,
    });
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    
    // Only process position change if actually dragged
    if (!hasDraggedRef.current) return;

    // Calculate target cell from current drag position
    const targetCell = pixelsToCell(
      dragPos.x + DESKTOP_GRID.cellWidth / 2,
      dragPos.y + DESKTOP_GRID.cellHeight / 2
    );

    // Clamp to grid bounds
    const clampedCol = Math.max(0, Math.min(gridSize.cols - 1, targetCell.col));
    const clampedRow = Math.max(0, Math.min(gridSize.rows - 1, targetCell.row));

    // Check if cell is occupied
    if (!isCellOccupied(clampedCol, clampedRow, iconId)) {
      onDragEnd({ col: clampedCol, row: clampedRow });
    }
    // If occupied, icon snaps back to original position (no action needed)
  };

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      handleDragEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragPos]);

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    handleDragMove(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = () => {
    handleDragEnd();
  };

  const currentPos = isDragging ? dragPos : pixelPos;

  return (
    <div
      style={{
        position: 'absolute',
        left: currentPos.x,
        top: currentPos.y,
        width: DESKTOP_GRID.cellWidth,
        height: DESKTOP_GRID.cellHeight,
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: isDragging ? 1000 : 1,
        opacity: isDragging ? 0.8 : 1,
        transition: isDragging ? 'none' : 'left 0.15s ease-out, top 0.15s ease-out',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        touchAction: 'none',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
};

// Start Menu
const StartMenu95 = ({ apps, onAppClick, onClose, isMobile, currentOS, onOSChange }) => {
  const [hoveredSubmenu, setHoveredSubmenu] = useState<string | null>(null);
  const menuBottom = isMobile ? 'bottom-14' : 'bottom-[30px]';
  const itemPadding = isMobile ? 'px-4 py-3' : 'px-3 py-1.5';
  const fontSize = isMobile ? 'text-sm' : 'text-xs';
  const menuWidth = isMobile ? 'flex-1' : 'w-48';

  const osOptions = [
    { id: 'win95', label: 'Windows 95' },
    { id: 'winxp', label: 'Windows XP' },
  ];

  // Computer/monitor icon for Switch OS
  const ComputerIcon = ({ size }) => (
    <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
      <rect x="1" y="1" width="14" height="10" fill="#000080"/>
      <rect x="2" y="2" width="12" height="8" fill="#008080"/>
      <rect x="5" y="12" width="6" height="1" fill="#808080"/>
      <rect x="4" y="13" width="8" height="1" fill="#808080"/>
    </svg>
  );
  
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute ${menuBottom} left-0 z-50 flex ${isMobile ? 'right-0 mx-2' : ''}`} style={{ backgroundColor: colors.gray, color: colors.black, ...raised }}>
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

          {/* Switch OS menu item with submenu */}
          <div 
            className="relative"
            onMouseEnter={() => setHoveredSubmenu('switchOS')}
            onMouseLeave={() => setHoveredSubmenu(null)}
          >
            <button 
              className={`w-full flex items-center gap-3 ${itemPadding} text-left ${hoveredSubmenu === 'switchOS' ? 'bg-[#000080] text-white' : ''}`}
              style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}
            >
              <span className={`${isMobile ? 'w-6' : 'w-5'} flex justify-center`}>
                <ComputerIcon size={isMobile ? 24 : 20} />
              </span>
              <span className={`${fontSize} flex-1`}>Switch OS</span>
              <span className={fontSize}>▶</span>
            </button>
            
            {/* OS Selection Submenu */}
            {hoveredSubmenu === 'switchOS' && (
              <div 
                className="absolute left-full top-0 ml-0"
                style={{ backgroundColor: colors.gray, color: colors.black, ...raised }}
              >
                <div className="py-1 w-36">
                  {osOptions.map((os) => (
                    <button
                      key={os.id}
                      onClick={() => { onOSChange(os.id); onClose(); }}
                      className={`w-full flex items-center gap-2 ${itemPadding} hover:bg-[#000080] hover:text-white active:bg-[#000080] active:text-white text-left`}
                      style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}
                    >
                      <span className={`${fontSize} w-4`}>{currentOS === os.id ? '✓' : ''}</span>
                      <span className={fontSize}>{os.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
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

// Windows XP Start Menu
const StartMenuXP = ({ apps, onAppClick, onClose, isMobile, currentOS, onOSChange }) => {
  const [hoveredSubmenu, setHoveredSubmenu] = useState<string | null>(null);
  const menuBottom = isMobile ? 'bottom-14' : 'bottom-[30px]';
  const fontSize = isMobile ? 'text-sm' : 'text-xs';

  const osOptions = [
    { id: 'win95', label: 'Windows 95' },
    { id: 'winxp', label: 'Windows XP' },
  ];

  const ComputerIcon = ({ size }) => (
    <svg viewBox="0 0 16 16" width={size} height={size} style={{ imageRendering: 'pixelated' }}>
      <rect x="1" y="1" width="14" height="10" fill="#0054E3"/>
      <rect x="2" y="2" width="12" height="8" fill="#3A6EA5"/>
      <rect x="5" y="12" width="6" height="1" fill="#ACA899"/>
      <rect x="4" y="13" width="8" height="1" fill="#ACA899"/>
    </svg>
  );

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div 
        className={`absolute ${menuBottom} left-0 z-50 ${isMobile ? 'right-0 mx-2' : ''} rounded-t-lg overflow-hidden`}
        style={{ 
          backgroundColor: colorsXP.windowBg,
          boxShadow: '2px 2px 10px rgba(0,0,0,0.4)',
          border: '1px solid #0054E3',
        }}
      >
        {/* XP User Header */}
        <div 
          className="flex items-center gap-3 px-3 py-2"
          style={{ background: colorsXP.windowTitleActive }}
        >
          <div 
            className="w-12 h-12 rounded-md flex items-center justify-center"
            style={{ 
              background: 'linear-gradient(to bottom, #E8A94E 0%, #D4883A 100%)',
              border: '2px solid white',
            }}
          >
            <span className="text-2xl">👤</span>
          </div>
          <span className="text-white font-bold text-lg" style={{ fontFamily: 'Trebuchet MS, Tahoma, sans-serif', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
            Ryan
          </span>
        </div>
        
        <div className="flex">
          {/* Left column - white with programs */}
          <div className={`${isMobile ? 'flex-1' : 'w-52'} bg-white py-1 text-black`}>
            {/* Pinned apps */}
            {apps.slice(0, 6).map((app) => (
              <button
                key={app.id}
                onClick={() => { onAppClick(app.id); onClose(); }}
                className={`w-full flex items-center gap-3 px-3 py-1.5 hover:bg-[#316AC5] hover:text-white text-left text-black`}
                style={{ fontFamily: 'Tahoma, sans-serif' }}
              >
                <span className="w-8 h-8 flex items-center justify-center">{app.menuIcon}</span>
                <div className="flex flex-col">
                  <span className={`${fontSize} font-semibold`}>{app.title.split(' - ')[0]}</span>
                </div>
              </button>
            ))}
            
            <div className="border-t border-[#ACA899] my-1 mx-3" />
            
            {/* All Programs */}
            <button 
              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-[#316AC5] hover:text-white text-left text-black"
              style={{ fontFamily: 'Tahoma, sans-serif' }}
            >
              <span className={`${fontSize} font-bold`}>All Programs</span>
              <span className={fontSize}>▶</span>
            </button>
          </div>
          
          {/* Right column - blue with system items */}
          <div 
            className={`${isMobile ? 'hidden' : 'w-48'} py-1 text-[#21347D]`}
            style={{ background: '#D3E5FA' }}
          >
            {[
              { icon: '📁', label: 'My Documents' },
              { icon: '🖼️', label: 'My Pictures' },
              { icon: '🎵', label: 'My Music' },
              { icon: '💻', label: 'My Computer' },
            ].map((item, i) => (
              <button 
                key={i}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-[#316AC5] hover:text-white text-left text-[#21347D]"
                style={{ fontFamily: 'Tahoma, sans-serif' }}
              >
                <span className="text-lg">{item.icon}</span>
                <span className={`${fontSize} font-semibold`}>{item.label}</span>
              </button>
            ))}
            
            <div className="border-t border-[#9BBAD8] my-1 mx-2" />
            
            {[
              { icon: '⚙️', label: 'Control Panel' },
              { icon: '🖨️', label: 'Printers and Faxes' },
              { icon: '❓', label: 'Help and Support' },
              { icon: '🔍', label: 'Search' },
              { icon: '▶️', label: 'Run...' },
            ].map((item, i) => (
              <button 
                key={i}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-[#316AC5] hover:text-white text-left text-[#21347D]"
                style={{ fontFamily: 'Tahoma, sans-serif' }}
              >
                <span className="text-lg">{item.icon}</span>
                <span className={fontSize}>{item.label}</span>
              </button>
            ))}
            
            <div className="border-t border-[#9BBAD8] my-1 mx-2" />
            
            {/* Switch OS */}
            <div 
              className="relative"
              onMouseEnter={() => setHoveredSubmenu('switchOS')}
              onMouseLeave={() => setHoveredSubmenu(null)}
            >
              <button 
                className={`w-full flex items-center gap-2 px-3 py-1 text-left ${hoveredSubmenu === 'switchOS' ? 'bg-[#316AC5] text-white' : 'text-[#21347D]'}`}
                style={{ fontFamily: 'Tahoma, sans-serif' }}
              >
                <span className="w-5 flex justify-center">
                  <ComputerIcon size={20} />
                </span>
                <span className={`${fontSize} flex-1`}>Switch OS</span>
                <span className={fontSize}>▶</span>
              </button>
              
              {hoveredSubmenu === 'switchOS' && (
                <div 
                  className="absolute right-full top-0 mr-0 rounded"
                  style={{ backgroundColor: '#D3E5FA', boxShadow: '-2px 2px 5px rgba(0,0,0,0.3)', border: '1px solid #0054E3' }}
                >
                  <div className="py-1 w-36">
                    {osOptions.map((os) => (
                      <button
                        key={os.id}
                        onClick={() => { onOSChange(os.id); onClose(); }}
                        className="w-full flex items-center gap-2 px-3 py-1 hover:bg-[#316AC5] hover:text-white text-left text-[#21347D]"
                        style={{ fontFamily: 'Tahoma, sans-serif' }}
                      >
                        <span className={`${fontSize} w-4`}>{currentOS === os.id ? '✓' : ''}</span>
                        <span className={fontSize}>{os.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Footer with Log Off and Turn Off */}
        <div 
          className="flex items-center justify-end gap-2 px-2 py-1"
          style={{ background: 'linear-gradient(to bottom, #3A80D2 0%, #2968B8 100%)' }}
        >
          <button 
            className="flex items-center gap-1 px-3 py-1 text-white hover:brightness-110 rounded"
            style={{ fontFamily: 'Tahoma, sans-serif', fontSize: '11px' }}
          >
            <span>🔓</span>
            <span>Log Off</span>
          </button>
          <button 
            className="flex items-center gap-1 px-3 py-1 text-white hover:brightness-110 rounded"
            style={{ 
              fontFamily: 'Tahoma, sans-serif', fontSize: '11px',
              background: 'linear-gradient(to bottom, #D64D37 0%, #C23A26 100%)',
              border: '1px solid #8B2213'
            }}
          >
            <span>⏻</span>
            <span>Turn Off Computer</span>
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
    <div className={`absolute bottom-0 left-0 right-0 ${taskbarHeight} flex items-center px-2 gap-2`} style={{ backgroundColor: colors.gray, color: colors.black, ...raised }}>
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

// Windows XP Taskbar
const TaskbarXP = ({ apps, windows, onAppClick, onStartClick, isStartOpen, isMobile }) => {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const taskbarHeight = isMobile ? 'h-14' : 'h-[30px]';
  const buttonHeight = isMobile ? 'h-10' : 'h-[22px]';
  const fontSize = isMobile ? 'text-sm' : 'text-xs';
  
  return (
    <div 
      className={`absolute bottom-0 left-0 right-0 ${taskbarHeight} flex items-center px-1 gap-1`} 
      style={{ 
        background: colorsXP.taskbar,
        borderTop: '1px solid #0C59CC',
      }}
    >
      {/* XP Start Button */}
      <button 
        onClick={onStartClick}
        className={`flex items-center gap-1.5 ${isMobile ? 'h-11 px-3' : 'h-[26px] px-2'} rounded-r-lg text-white font-bold shadow-md transition-all`}
        style={{ 
          background: isStartOpen ? colorsXP.startBtnGreenActive : colorsXP.startBtnGreen,
          fontFamily: 'Trebuchet MS, Tahoma, sans-serif',
          fontSize: isMobile ? '14px' : '12px',
          textShadow: '1px 1px 1px rgba(0,0,0,0.3)',
          border: '1px solid #2D9B1D',
          borderLeft: 'none',
          marginLeft: '-1px',
        }}
        onMouseEnter={(e) => { if (!isStartOpen) e.currentTarget.style.background = colorsXP.startBtnGreenHover; }}
        onMouseLeave={(e) => { if (!isStartOpen) e.currentTarget.style.background = colorsXP.startBtnGreen; }}
      >
        {/* Windows XP Logo */}
        <svg viewBox="0 0 20 20" className={isMobile ? 'w-6 h-6' : 'w-4 h-4'}>
          <circle cx="10" cy="10" r="9" fill="#3C8D2F" stroke="#2D7B1F" strokeWidth="1"/>
          <g transform="translate(4, 4)">
            <rect x="0" y="0" width="5" height="5" fill="#FF6D00" rx="0.5"/>
            <rect x="6" y="0" width="5" height="5" fill="#04AEF4" rx="0.5"/>
            <rect x="0" y="6" width="5" height="5" fill="#00AD45" rx="0.5"/>
            <rect x="6" y="6" width="5" height="5" fill="#FFCD00" rx="0.5"/>
          </g>
        </svg>
        <span className="italic">start</span>
      </button>
      
      {/* Quick Launch divider */}
      <div className={`w-px ${isMobile ? 'h-8' : 'h-5'} mx-1`} style={{ background: 'linear-gradient(to bottom, #1956C7 0%, #5A8AD7 50%, #1956C7 100%)' }} />
      
      {/* Task buttons area */}
      <div className="flex-1 flex gap-1 overflow-hidden px-1">
        {apps.filter(app => windows[app.id]?.isOpen).map((app) => (
          <button
            key={app.id}
            onClick={() => onAppClick(app.id)}
            className={`${buttonHeight} px-2 flex items-center gap-2 ${fontSize} ${isMobile ? 'min-w-[60px]' : 'min-w-[140px] max-w-[180px]'} truncate rounded text-white`}
            style={{ 
              background: windows[app.id]?.isMinimized 
                ? 'linear-gradient(to bottom, #3C81E0 0%, #2F6FD1 50%, #1C5BBF 100%)'
                : 'linear-gradient(to bottom, #1C5BBF 0%, #1554B5 50%, #0F44A0 100%)',
              border: '1px solid #0C3B8B',
              fontFamily: 'Tahoma, sans-serif',
              textShadow: '1px 1px 1px rgba(0,0,0,0.3)',
            }}
          >
            <span className={`${isMobile ? 'w-5' : 'w-4'} shrink-0`}>{app.menuIcon}</span>
            {!isMobile && <span className="truncate">{app.title}</span>}
          </button>
        ))}
      </div>
      
      {/* System tray */}
      <div 
        className={`${buttonHeight} px-3 flex items-center gap-2 ${fontSize} text-white rounded`}
        style={{ 
          background: 'linear-gradient(to bottom, #0F6DD6 0%, #1563CC 50%, #0A51A8 100%)',
          border: '1px solid #0C3B8B',
          fontFamily: 'Tahoma, sans-serif',
        }}
      >
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
        <p className="text-[#000080] font-bold text-[11px]">Product Design Manager</p>
        <p className="mt-1 leading-relaxed">
          Senior Product Designer specializing in enterprise products, web/app development, and AR/VR. 
          Currently leading design at Belva AI.
        </p>
      </div>
    </div>
    
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2 mb-3">
      <legend className="px-1">System Properties</legend>
      <table className="w-full text-[11px]">
        <tbody>
          <tr><td className="py-px text-[#808080] w-24">Experience:</td><td className="py-px font-bold">4+ years</td></tr>
          <tr><td className="py-px text-[#808080]">Specialty:</td><td className="py-px font-bold">Enterprise, AR/VR</td></tr>
          <tr><td className="py-px text-[#808080]">Location:</td><td className="py-px font-bold">Bellingham, WA</td></tr>
          <tr><td className="py-px text-[#808080]">Status:</td><td className="py-px font-bold text-[#008000]">● Available</td></tr>
        </tbody>
      </table>
    </fieldset>
    
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2">
      <legend className="px-1">Installed Skills</legend>
      <div className="flex flex-wrap gap-1">
        {['UX/UI Design', 'UX Research', 'Figma', 'Miro', 'Adobe Suite', 'HTML/CSS', 'Swift', 'Blender', 'Unity'].map((skill, i) => (
          <span key={i} className="px-2 py-px text-[11px]" style={{ backgroundColor: colors.gray, ...raised }}>
            {skill}
          </span>
        ))}
      </div>
    </fieldset>
  </div>
);

const ProjectsContent = ({ onOpenProject, currentOS = 'win95' }: { onOpenProject?: (id: string) => void; currentOS?: string }) => {
  const isXP = currentOS === 'winxp';
  const bgColor = isXP ? colorsXP.windowBg : colors.gray;
  const buttonBorder = isXP ? raisedXP : raised;
  const tagStyle = isXP ? insetXP : inset;
  const borderColor = isXP ? '#ACA899' : '#808080';
  const fontFamily = isXP ? 'Tahoma, sans-serif' : '"MS Sans Serif", Tahoma, sans-serif';
  const linkColor = isXP ? '#0066CC' : '#0000ff';
  const IconComponent = isXP ? XPIcon : PixelIcon;

  return (
    <div className="h-full flex flex-col" style={{ fontFamily, fontSize: '11px' }}>
      <div className={`flex items-center gap-1 p-1 border-b`} style={{ borderColor }}>
        <span className="px-1">📁</span>
        <span>{isXP ? 'C:\\Documents and Settings\\Ryan\\Projects' : 'C:\\Portfolio\\Projects'}</span>
      </div>
      
      <div className="flex-1 p-2 overflow-auto">
        {/* Project Cards */}
        <div className="space-y-2">
          <button 
            onClick={() => {
              onOpenProject?.('vmware-case');
              onOpenProject?.('global-search-gallery');
            }}
            className={`w-full text-left p-2 cursor-pointer hover:brightness-95 active:brightness-90 ${isXP ? 'rounded' : ''}`}
            style={{ backgroundColor: bgColor, ...buttonBorder }}
          >
            <div className="flex items-start gap-2">
              <IconComponent type="notepad" size={32} />
              <div className="flex-1">
                <h3 className="font-bold text-[12px] underline" style={{ color: linkColor }}>VMware - Global Search</h3>
                <p className="text-[10px]" style={{ color: borderColor }}>2023 | VMware</p>
                <p className="text-[11px] mt-1">Created a unified search experience across all VMware services. Led UX/UI design, user research, and proof of concept development.</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {['UX/UI Design', 'User Research', 'POC'].map((tag, i) => (
                    <span key={i} className={`px-1 text-[9px] ${isXP ? 'rounded' : ''}`} style={{ backgroundColor: isXP ? '#F1EFE2' : '#e0e0e0', ...tagStyle }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-[9px] mt-1" style={{ color: borderColor }}>📄 Click to view case study + screenshots</p>
              </div>
            </div>
          </button>
          
          <button 
            onClick={() => onOpenProject?.('island-health-case')}
            className={`w-full text-left p-2 cursor-pointer hover:brightness-95 active:brightness-90 ${isXP ? 'rounded' : ''}`}
            style={{ backgroundColor: bgColor, ...buttonBorder }}
          >
            <div className="flex items-start gap-2">
              <IconComponent type="notepad" size={32} />
              <div className="flex-1">
                <h3 className="font-bold text-[12px] underline" style={{ color: linkColor }}>Island Health - Website</h3>
                <p className="text-[10px]" style={{ color: borderColor }}>2021 | Brick & Brine Creative Agency</p>
                <p className="text-[11px] mt-1">Redesigned the website for Island Health hospital in Anacortes, WA serving 130,000+ locals. Conducted user research, created wireframes, prototypes, and usability tests.</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {['UX/UI Design', 'User Research', 'Web'].map((tag, i) => (
                    <span key={i} className={`px-1 text-[9px] ${isXP ? 'rounded' : ''}`} style={{ backgroundColor: isXP ? '#F1EFE2' : '#e0e0e0', ...tagStyle }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-[9px] mt-1" style={{ color: borderColor }}>📄 Click to view case study</p>
              </div>
            </div>
          </button>
        </div>
      </div>
      
      <div className="px-2 py-1 border-t text-[10px]" style={{ borderColor, color: borderColor }}>
        2 project(s)
      </div>
    </div>
  );
};

const ContactContent = () => (
  <div className="p-3" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', fontSize: '11px' }}>
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2 mb-3">
      <legend className="px-1">✉️ Compose Message</legend>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <label className="w-12 text-right">To:</label>
          <input type="text" defaultValue="ryanjherrin@gmail.com" className="flex-1 px-1 py-px text-[11px]" style={{ ...inset, backgroundColor: 'white', color: 'black' }} readOnly />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-12 text-right">From:</label>
          <input type="text" placeholder="Your email" className="flex-1 px-1 py-px text-[11px]" style={{ ...inset, backgroundColor: 'white', color: 'black' }} />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-12 text-right">Subject:</label>
          <input type="text" placeholder="Let's work together!" className="flex-1 px-1 py-px text-[11px]" style={{ ...inset, backgroundColor: 'white', color: 'black' }} />
        </div>
        <div className="flex items-start gap-2">
          <label className="w-12 text-right pt-1">Message:</label>
          <textarea className="flex-1 px-1 py-px text-[11px] h-20 resize-none" style={{ ...inset, backgroundColor: 'white', color: 'black' }} placeholder="Type your message here..." />
        </div>
        <div className="flex justify-end gap-1 pt-1">
          <Button95 className="text-[11px] px-3">📤 Send</Button95>
          <Button95 className="text-[11px] px-3">Clear</Button95>
        </div>
      </div>
    </fieldset>
    
    <fieldset className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2">
      <legend className="px-1">🔗 Contact Info</legend>
      <div className="space-y-0.5">
        <p>📧 <a href="mailto:ryanjherrin@gmail.com" className="text-[#0000ff] underline">ryanjherrin@gmail.com</a></p>
        <p>📞 <span className="text-black">(+1) 425 736 0144</span></p>
        <p>💼 <a href="https://linkedin.com/in/ryanjherrin" target="_blank" rel="noopener noreferrer" className="text-[#0000ff] underline">linkedin.com/in/ryanjherrin</a></p>
        <p>🌐 <a href="https://ryanherrin.com" target="_blank" rel="noopener noreferrer" className="text-[#0000ff] underline">ryanherrin.com</a></p>
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
    'RYAN_HERRIN - Product Design Manager @ Belva AI',
    '',
    'C:\\RYAN>dir /skills',
    '',
    ' Volume in drive C is PORTFOLIO',
    ' Directory of C:\\RYAN\\SKILLS',
    '',
    'UXUI     EXE     8,192  01-21-26',
    'FIGMA    EXE     4,096  01-21-26',
    'MIRO     DLL     2,048  01-21-26',
    'ADOBE    EXE     6,144  01-21-26',
    'SWIFT    EXE     4,096  01-21-26',
    'BLENDER  EXE     8,192  01-21-26',
    'UNITY    EXE     6,144  01-21-26',
    '',
    '        7 file(s)     38,912 bytes',
    '',
    'C:\\RYAN>echo %STATUS%',
    'Available for work!',
    '',
    'C:\\RYAN>echo %LOCATION%',
    'Bellingham, WA',
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

Hey there! I'm Ryan Herrin, a Product Design 
Manager based in Bellingham, WA. I specialize 
in enterprise products, web/app development, 
and AR/VR.

Previously at VMware, I led design for the 
global header and built a search feature from 
scratch. Our commerce solution won VMware's 
Design Borathon competition!

Why Windows 95? This OS was revolutionary:
• Invented the Start menu
• Created the taskbar  
• Established the desktop metaphor

30 years later, these concepts still work.
Understanding design history makes you better 
at designing the future.

Feel free to explore!
• Double-click icons to open apps
• Drag corners to resize windows
• Windows snap to edges & each other!
• Try Minesweeper (I dare you)
• Clippy might have some tips
• Check out the Media Player!

Let's connect: ryanjherrin@gmail.com

- Ryan`}
  </div>
);

// VMware Global Search Case Study
const VMwareCaseStudy = () => (
  <div className="h-full p-3 overflow-auto text-[11px] leading-relaxed" style={{ fontFamily: 'Courier New, monospace', backgroundColor: 'white' }}>
    <pre className="whitespace-pre-wrap">
{`===============================================
  VMWARE GLOBAL SEARCH - CASE STUDY
  GlobalSearch.txt
===============================================

ROLE: Product Designer
DURATION: March 2023 - November 2023
COMPANY: VMware

-----------------------------------------------
THE PROBLEM
-----------------------------------------------

Currently, VMware offers no ability to search 
for services or resources. When users need to 
find objects or capabilities across their 
VMware Cloud ecosystem, they must have a high 
level of VMware expertise in order to find 
what they're looking for.

The Global Search project aims to create a 
unified and efficient search experience across 
all VMware services.

  "Lost customers = Loss of customers"
  
  New users feel lost when navigating across 
  their VMware ecosystem.

-----------------------------------------------
PROCESS
-----------------------------------------------

COMPETITIVE ANALYSIS
With a short timeline to develop a proof of 
concept (POC), we focused on conducting a 
competitive analysis and gathering relevant 
user analytics.

WIREFRAMES & ITERATIONS
During weekly meetings, I presented my 
iterations to the team where we discussed 
design decisions, project goals, and 
feasibility.

DESIGN OPTIONS EXPLORED:

1. Side Panel Search
   - Would work for short-term as it was 
     already developed for previous use case
   
2. Center Search Bar (CHOSEN)
   - Broader space for robust search results
   - More familiar pattern for users
   - Easier to find and use

NO RESULTS FOUND STATE
Our team wanted to provide a call to action 
at dead ends. When customers cannot find what 
they're searching for, we use this as an 
opportunity to understand expectations. This 
connects to a database storing every search.

-----------------------------------------------
FINAL POC
-----------------------------------------------

To get stakeholder buy-in from other teams, 
we created a proof of concept to demonstrate 
the value of the search. We established the 
POC within VMware's Cloud Console where 
customers first land before accessing other 
VMware services.

-----------------------------------------------
USER SURVEY RESULTS
-----------------------------------------------

One month after the POC went live in staging, 
I created a survey to gather insights.

KEY FINDINGS:

>> 76% of customers wanted results from ALL 
   their services.
   
   Our team had differing views on this, and 
   the results helped us align moving forward.

>> 89% of customers said they would search 
   for RESOURCES the most.
   
   No one expected this on our team and it 
   shifted our direction for the project.

>> There is a need for a SINGLE PLACE to 
   manage resources.
   
   Multiple customers mentioned this without 
   a question prompting the subject.

-----------------------------------------------
REFLECTIONS
-----------------------------------------------

HIGHLIGHTS:
- Team worked extremely well together
- Disagreements resolved quickly
- Each voice was valued equally
- Built roster of 100+ customers willing to 
  participate in future research
- Opened door to VMware services acting as 
  one rather than separate entities

IMPROVEMENTS:
- Getting other services on board proved 
  difficult
- Had to move slower with rollout approach 
  due to crash concerns
- Could have started user survey before 
  working on the design

===============================================
  View full case study: ryanherrin.com
===============================================`}
    </pre>
  </div>
);

// Global Search Gallery Component
const GlobalSearchGallery = ({ currentOS = 'win95' }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // OS-specific styling
  const isXP = currentOS === 'winxp';
  const bgColor = isXP ? colorsXP.windowBg : colors.gray;
  const buttonBorder = isXP ? raisedXP : raised;
  const borderStyle = isXP ? insetXP : inset;
  const borderColor = isXP ? '#ACA899' : colors.darkGray;
  const fontFamily = isXP ? 'Tahoma, sans-serif' : '"MS Sans Serif", Tahoma, sans-serif';
  
  const images = [
    { src: '/gs1.png', label: 'Screenshot 1' },
    { src: '/gs2.png', label: 'Screenshot 2' },
    { src: '/gs3.png', label: 'Screenshot 3' },
    { src: '/gs4.png', label: 'Screenshot 4' },
    { src: '/gs5.png', label: 'Screenshot 5' },
    { src: '/gs6.png', label: 'Screenshot 6' },
    { src: '/gs7.png', label: 'Screenshot 7' },
    { src: '/gs8.png', label: 'Screenshot 8' },
    { src: '/gs9.png', label: 'Screenshot 9' },
    { src: '/gs10.png', label: 'Screenshot 10' },
  ];

  const goToPrev = () => {
    setSelectedIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setSelectedIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="h-full flex flex-col" style={{ fontFamily, fontSize: '11px', backgroundColor: bgColor }}>
      {/* Navigation bar */}
      <div className="flex items-center justify-between p-2 border-b" style={{ borderColor }}>
        <button
          onClick={goToPrev}
          className={`px-3 py-1 cursor-pointer ${isXP ? 'rounded' : ''}`}
          style={{ ...buttonBorder, backgroundColor: bgColor }}
        >
          &lt; Prev
        </button>
        <span style={{ color: colors.black }}>
          Image {selectedIndex + 1} of {images.length}
        </span>
        <button
          onClick={goToNext}
          className={`px-3 py-1 cursor-pointer ${isXP ? 'rounded' : ''}`}
          style={{ ...buttonBorder, backgroundColor: bgColor }}
        >
          Next &gt;
        </button>
      </div>

      {/* Main preview area */}
      <div className="flex-1 p-2 overflow-hidden">
        <div 
          className={`w-full h-full flex items-center justify-center ${isXP ? 'rounded' : ''}`}
          style={{ ...borderStyle, backgroundColor: '#ffffff' }}
        >
          <img
            src={images[selectedIndex].src}
            alt={images[selectedIndex].label}
            className="max-w-full max-h-full object-contain"
            style={{ imageRendering: 'auto' }}
          />
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="p-2 border-t" style={{ borderColor }}>
        <div 
          className="flex gap-1 overflow-x-auto pb-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {images.map((image, index) => (
            <button
              key={index}
              onClick={() => setSelectedIndex(index)}
              className={`shrink-0 cursor-pointer p-1 ${isXP ? 'rounded' : ''}`}
              style={{
                ...(index === selectedIndex ? borderStyle : buttonBorder),
                backgroundColor: index === selectedIndex ? (isXP ? '#D3E5FA' : colors.white) : bgColor,
                width: '60px',
                height: '45px',
                border: index === selectedIndex && isXP ? '2px solid #316AC5' : undefined,
              }}
            >
              <img
                src={image.src}
                alt={image.label}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// Island Health Case Study
const IslandHealthCaseStudy = () => (
  <div className="h-full p-3 overflow-auto text-[11px] leading-relaxed" style={{ fontFamily: 'Courier New, monospace', backgroundColor: 'white' }}>
    <pre className="whitespace-pre-wrap">
{`===============================================
  ISLAND HEALTH WEBSITE - CASE STUDY
  IslandHealth.txt
===============================================

ROLE: Product Designer
DURATION: September 2021 - December 2021
COMPANY: Brick & Brine Creative Agency
CLIENT: Island Health Hospital, Anacortes, WA

-----------------------------------------------
THE PROBLEM
-----------------------------------------------

Island Health's navigation and information 
architecture was difficult to follow, causing 
users to be deterred when trying to find 
information.

Pages usually led the user to a phone number, 
which increased daily calls beyond what their 
office could handle. Patients who were unable 
to physically visit the hospital experienced 
high wait times when calling.

  "Pages ended in a phone number, 
   not a solution."
  
  When users want to complete a task on 
  Island Health's website, a phone number 
  is a poor solution.

-----------------------------------------------
GOALS & ALIGNMENT
-----------------------------------------------

While auditing Island Health's site, we 
aligned with the marketing team on their goals:

PRIORITY 1: Improve Navigation
- Site contained poorly organized information
- Map information architecture
- Conduct user research to reorganize 
  navigation effectively

PRIORITY 2: Reduce Office Calls
- Improve accessibility of information
- Fix pages ending with phone number as CTA

-----------------------------------------------
PROCESS
-----------------------------------------------

USER SURVEY
We created two surveys for internal and 
external users. Starting with umbrella 
questions and HMWs, we brainstormed what 
questions to ask our users. After gathering 
data, we organized significant findings and 
opportunities.

USER INTERVIEWS
Conducting user interviews led to crucial 
findings regarding:
- What information patients call about
- Their current pain points

INFORMATION ARCHITECTURE
After completing an audit of their entire 
site, I mapped out their current site and 
brainstormed better ways to organize their 
information. This was quite a challenge with 
so many pages within the navigation.

WIREFRAMES
During wireframing stages, we designed 
multiple iterations from sketches through 
high-fidelity wireframes. I focused heavily 
on navigation to ensure important information 
was easy to find for users.

-----------------------------------------------
FINAL NAVIGATION
-----------------------------------------------

After approval from the client, we finalized 
the navigation design. Focusing on clarity 
for the user led to structuring the navigation 
into categories from their perspective.

-----------------------------------------------
USABILITY TESTING
-----------------------------------------------

Before launch, we meticulously tested the site:
- Updated content per client requests
- Tested responsiveness
- Verified accessibility
- Checked all links

-----------------------------------------------
RESULTS
-----------------------------------------------

- Improved navigation structure
- Reduced phone calls to office
- Better information accessibility
- User-centric category organization
- Serving 130,000+ local residents

===============================================
  View full case study: ryanherrin.com
===============================================`}
    </pre>
  </div>
);

// Resume Component - styled like a Word document
const ResumeContent = () => (
  <div className="h-full flex flex-col" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', fontSize: '11px' }}>
    {/* Word-like toolbar */}
    <div className="flex items-center gap-1 px-1 py-0.5 border-b border-[#808080]" style={{ backgroundColor: colors.gray }}>
      <span className="text-[10px] px-1">📄</span>
      <span className="text-[10px]">Resume.doc - Microsoft Word</span>
    </div>
    
    {/* Document content */}
    <div className="flex-1 p-4 overflow-auto" style={{ backgroundColor: 'white' }}>
      <div className="max-w-[500px] mx-auto">
        {/* Header */}
        <div className="text-center mb-4 pb-2 border-b-2 border-[#000080]">
          <h1 className="text-[16px] font-bold text-[#000080]">RYAN HERRIN</h1>
          <p className="text-[11px] text-[#808080]">Product Design Manager</p>
          <p className="text-[10px] mt-1">Bellingham, WA | ryanjherrin@gmail.com | (425) 736-0144</p>
        </div>
        
        {/* Summary */}
        <div className="mb-3">
          <h2 className="text-[12px] font-bold text-[#000080] border-b border-[#c0c0c0] mb-1">SUMMARY</h2>
          <p className="text-[11px] leading-relaxed">
            Senior Product Designer with 4+ years of experience in enterprise products, web/app development, and AR/VR. 
            Skilled in leading cross-functional teams and creating user-centered solutions.
          </p>
        </div>
        
        {/* Experience */}
        <div className="mb-3">
          <h2 className="text-[12px] font-bold text-[#000080] border-b border-[#c0c0c0] mb-1">EXPERIENCE</h2>
          
          <div className="mb-2">
            <div className="flex justify-between items-baseline">
              <h3 className="text-[11px] font-bold">Product Design Manager</h3>
              <span className="text-[10px] text-[#808080]">2025 - Present</span>
            </div>
            <p className="text-[10px] text-[#000080]">Belva AI</p>
          </div>
          
          <div className="mb-2">
            <div className="flex justify-between items-baseline">
              <h3 className="text-[11px] font-bold">Senior Product Designer</h3>
              <span className="text-[10px] text-[#808080]">2024 - 2025</span>
            </div>
            <p className="text-[10px] text-[#000080]">Haptic Studios</p>
          </div>
          
          <div className="mb-2">
            <div className="flex justify-between items-baseline">
              <h3 className="text-[11px] font-bold">Product Designer</h3>
              <span className="text-[10px] text-[#808080]">2022 - 2024</span>
            </div>
            <p className="text-[10px] text-[#000080]">VMware</p>
            <p className="text-[10px] mt-0.5">Led design for global header and search feature. Winner of VMware Design Borathon.</p>
          </div>
          
          <div className="mb-2">
            <div className="flex justify-between items-baseline">
              <h3 className="text-[11px] font-bold">UX Design Researcher</h3>
              <span className="text-[10px] text-[#808080]">2020 - 2022</span>
            </div>
            <p className="text-[10px] text-[#000080]">Brick & Brine Creative Agency</p>
          </div>
          
          <div className="mb-2">
            <div className="flex justify-between items-baseline">
              <h3 className="text-[11px] font-bold">Junior UX/UI Designer</h3>
              <span className="text-[10px] text-[#808080]">2019 - 2020</span>
            </div>
            <p className="text-[10px] text-[#000080]">Trilogy Education</p>
          </div>
        </div>
        
        {/* Skills */}
        <div>
          <h2 className="text-[12px] font-bold text-[#000080] border-b border-[#c0c0c0] mb-1">SKILLS</h2>
          <div className="flex flex-wrap gap-1">
            {['UX/UI Design', 'UX Research', 'Responsive Web', 'HTML5', 'CSS3', 'Swift', 'Figma', 'Miro', 'Adobe Suite', 'Blender', 'Unity', 'Jira'].map((skill, i) => (
              <span key={i} className="px-1.5 py-0.5 text-[9px]" style={{ backgroundColor: '#e8e8e8', border: '1px solid #c0c0c0' }}>
                {skill}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
    
    {/* Status bar */}
    <div className="px-2 py-0.5 border-t border-[#808080] text-[10px] flex justify-between" style={{ backgroundColor: colors.gray }}>
      <span>Page 1 of 1</span>
      <span>Ln 1, Col 1</span>
    </div>
  </div>
);

// Paint App
const PaintContent = ({ currentOS = 'win95' }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState('pencil');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(2);
  const [secondaryColor, setSecondaryColor] = useState('#ffffff');
  const lastPos = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const [canvasHistory, setCanvasHistory] = useState([]);

  // OS-specific styling
  const isXP = currentOS === 'winxp';
  const bgColor = isXP ? colorsXP.windowBg : colors.gray;
  const borderStyle = isXP ? insetXP : inset;
  const buttonBorder = isXP ? raisedXP : raised;
  const borderColor = isXP ? '#ACA899' : '#808080';

  const paintColors = [
    '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080',
    '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff',
    '#c0c080', '#404040', '#ff8000', '#80ff00', '#00ff80', '#0080ff', '#8000ff', '#ff0080',
  ];

  const tools = [
    { id: 'pencil', label: '✏️', title: 'Pencil' },
    { id: 'brush', label: '🖌️', title: 'Brush' },
    { id: 'eraser', label: '🧽', title: 'Eraser' },
    { id: 'fill', label: '🪣', title: 'Fill' },
    { id: 'line', label: '📏', title: 'Line' },
    { id: 'rect', label: '⬜', title: 'Rectangle' },
    { id: 'ellipse', label: '⭕', title: 'Ellipse' },
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const imageData = canvas.toDataURL();
      setCanvasHistory(prev => [...prev.slice(-10), imageData]);
    }
  };

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const floodFill = (startX, startY, fillColor) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    const startIdx = (Math.floor(startY) * canvas.width + Math.floor(startX)) * 4;
    const startR = data[startIdx];
    const startG = data[startIdx + 1];
    const startB = data[startIdx + 2];
    
    const fillR = parseInt(fillColor.slice(1, 3), 16);
    const fillG = parseInt(fillColor.slice(3, 5), 16);
    const fillB = parseInt(fillColor.slice(5, 7), 16);
    
    if (startR === fillR && startG === fillG && startB === fillB) return;
    
    const stack = [[Math.floor(startX), Math.floor(startY)]];
    const visited = new Set();
    
    while (stack.length > 0 && stack.length < 100000) {
      const [x, y] = stack.pop();
      const key = `${x},${y}`;
      
      if (visited.has(key) || x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
      visited.add(key);
      
      const idx = (y * canvas.width + x) * 4;
      if (Math.abs(data[idx] - startR) > 10 || Math.abs(data[idx + 1] - startG) > 10 || Math.abs(data[idx + 2] - startB) > 10) continue;
      
      data[idx] = fillR;
      data[idx + 1] = fillG;
      data[idx + 2] = fillB;
      data[idx + 3] = 255;
      
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    
    ctx.putImageData(imageData, 0, 0);
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const pos = getPos(e);
    setIsDrawing(true);
    lastPos.current = pos;
    startPos.current = pos;
    
    if (tool === 'fill') {
      saveToHistory();
      floodFill(pos.x, pos.y, color);
      setIsDrawing(false);
    }
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e);
    
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.lineWidth = tool === 'brush' ? brushSize * 3 : brushSize;
      ctx.lineCap = 'round';
      ctx.stroke();
      lastPos.current = pos;
    }
  };

  const stopDrawing = (e) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = e ? getPos(e) : lastPos.current;
    
    if (tool === 'line') {
      saveToHistory();
      ctx.beginPath();
      ctx.moveTo(startPos.current.x, startPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.stroke();
    } else if (tool === 'rect') {
      saveToHistory();
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.strokeRect(
        startPos.current.x, startPos.current.y,
        pos.x - startPos.current.x, pos.y - startPos.current.y
      );
    } else if (tool === 'ellipse') {
      saveToHistory();
      const centerX = (startPos.current.x + pos.x) / 2;
      const centerY = (startPos.current.y + pos.y) / 2;
      const radiusX = Math.abs(pos.x - startPos.current.x) / 2;
      const radiusY = Math.abs(pos.y - startPos.current.y) / 2;
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.stroke();
    } else if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      saveToHistory();
    }
    
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    saveToHistory();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const undo = () => {
    if (canvasHistory.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = canvasHistory[canvasHistory.length - 1];
    setCanvasHistory(prev => prev.slice(0, -1));
  };

  const saveImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Create a download link
    const link = document.createElement('a');
    link.download = `paint-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: bgColor, color: colors.black }}>
      {/* Toolbar */}
      <div className={`flex items-center gap-1 p-1 border-b`} style={{ backgroundColor: bgColor, borderColor }}>
        {tools.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={t.title}
            className={`w-6 h-6 flex items-center justify-center text-xs ${isXP ? 'rounded' : ''}`}
            style={{
              backgroundColor: bgColor,
              ...(tool === t.id ? borderStyle : buttonBorder),
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="w-px h-5 mx-1" style={{ backgroundColor: borderColor }} />
        <select 
          value={brushSize} 
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className={`text-[10px] px-1 ${isXP ? 'rounded' : ''}`}
          style={{ backgroundColor: 'white', color: 'black', border: `1px solid ${borderColor}` }}
        >
          <option value={1}>1px</option>
          <option value={2}>2px</option>
          <option value={4}>4px</option>
          <option value={8}>8px</option>
        </select>
        <div className="w-px h-5 mx-1" style={{ backgroundColor: borderColor }} />
        <button onClick={undo} className={`px-2 h-6 text-[10px] ${isXP ? 'rounded' : ''}`} style={{ backgroundColor: bgColor, ...buttonBorder }}>Undo</button>
        <button onClick={clearCanvas} className={`px-2 h-6 text-[10px] ${isXP ? 'rounded' : ''}`} style={{ backgroundColor: bgColor, ...buttonBorder }}>Clear</button>
        <div className="flex-1" />
        <button onClick={saveImage} className={`px-2 h-6 text-[10px] ${isXP ? 'rounded' : ''}`} style={{ backgroundColor: bgColor, ...buttonBorder }}>💾 Save</button>
      </div>
      
      <div className="flex flex-1 min-h-0">
        {/* Tool panel */}
        <div className="w-10 p-1 flex flex-col gap-1 border-r" style={{ backgroundColor: bgColor, borderColor }}>
          {/* Color preview */}
          <div className={`relative w-8 h-8 mb-1 ${isXP ? 'rounded' : ''}`} style={buttonBorder}>
            <div 
              className={`absolute top-0 left-0 w-5 h-5 border border-black ${isXP ? 'rounded-sm' : ''}`}
              style={{ backgroundColor: color }}
              title="Primary color (left click)"
            />
            <div 
              className={`absolute bottom-0 right-0 w-5 h-5 border border-black ${isXP ? 'rounded-sm' : ''}`}
              style={{ backgroundColor: secondaryColor }}
              title="Secondary color (right click)"
            />
          </div>
        </div>
        
        {/* Canvas area */}
        <div className="flex-1 overflow-auto p-1" style={{ backgroundColor: isXP ? '#7A96DF' : '#808080' }}>
          <canvas
            ref={canvasRef}
            width={400}
            height={300}
            className="cursor-crosshair"
            style={{ backgroundColor: '#ffffff', imageRendering: 'pixelated' }}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>
      </div>
      
      {/* Color palette */}
      <div className={`flex items-center gap-px p-1 border-t`} style={{ backgroundColor: bgColor, borderColor: isXP ? borderColor : 'white' }}>
        {paintColors.map((c, i) => (
          <button
            key={i}
            className={`w-4 h-4 border border-black ${isXP ? 'rounded-sm' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
            onContextMenu={(e) => { e.preventDefault(); setSecondaryColor(c); }}
            title={c}
          />
        ))}
      </div>
    </div>
  );
};

// Media Player - 1995 Greatest Hits (YouTube-powered)
// 1995 Greatest Hits playlist with YouTube video IDs
const PLAYLIST_1995: Track[] = [
  { id: '1', title: "Gangsta's Paradise", artist: "Coolio ft. L.V.", youtubeId: "fPO76Jlnz6c", duration: "4:00", durationSec: 240, source: 'youtube' },
  { id: '2', title: "Waterfalls", artist: "TLC", youtubeId: "8WEtxJ4-sh4", duration: "4:39", durationSec: 279, source: 'youtube' },
  { id: '3', title: "Creep", artist: "TLC", youtubeId: "LlZydtG3xqI", duration: "4:30", durationSec: 270, source: 'youtube' },
  { id: '4', title: "Kiss from a Rose", artist: "Seal", youtubeId: "hDd2G_V1rzc", duration: "4:46", durationSec: 286, source: 'youtube' },
  { id: '5', title: "On Bended Knee", artist: "Boyz II Men", youtubeId: "jSUSFow70no", duration: "5:31", durationSec: 331, source: 'youtube' },
  { id: '6', title: "One Sweet Day", artist: "Mariah Carey & Boyz II Men", youtubeId: "UXxRyNvTPr8", duration: "4:42", durationSec: 282, source: 'youtube' },
  { id: '7', title: "Fantasy", artist: "Mariah Carey", youtubeId: "qq09UkPRdFY", duration: "4:04", durationSec: 244, source: 'youtube' },
  { id: '8', title: "Take a Bow", artist: "Madonna", youtubeId: "XDeiovnCv1o", duration: "5:21", durationSec: 321, source: 'youtube' },
  { id: '9', title: "Wonderwall", artist: "Oasis", youtubeId: "bx1Bh8ZvH84", duration: "4:18", durationSec: 258, source: 'youtube' },
  { id: '10', title: "You Oughta Know", artist: "Alanis Morissette", youtubeId: "NPcyTyilmYY", duration: "4:09", durationSec: 249, source: 'youtube' },
  { id: '11', title: "Runaway", artist: "Janet Jackson", youtubeId: "AtoyLKHmy1c", duration: "4:31", durationSec: 271, source: 'youtube' },
  { id: '12', title: "This Is How We Do It", artist: "Montell Jordan", youtubeId: "0hiUuL5uTKc", duration: "3:54", durationSec: 234, source: 'youtube' },
];

// Album definitions
type AlbumId = '1995-hits' | 'my-music';

const ALBUMS: { id: AlbumId; name: string; icon: string }[] = [
  { id: '1995-hits', name: '1995 Greatest Hits', icon: '💿' },
  { id: 'my-music', name: 'My Music', icon: '📁' },
];

// Media Player Skin definitions
type MediaPlayerSkin = 'classic' | 'winamp' | 'silver' | 'synthwave';

const MEDIA_PLAYER_SKINS: Record<MediaPlayerSkin, {
  name: string;
  bg: string;
  bgSecondary: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentSecondary: string;
  visualizerColors: [string, string, string];
  buttonBg: string;
  buttonText: string;
  cdOuter: string;
  cdInner: string;
  glow: string;
}> = {
  classic: {
    name: 'Classic',
    bg: '#000080',
    bgSecondary: '#000000',
    text: '#ffffff',
    textSecondary: '#c0c0c0',
    accent: '#00ff00',
    accentSecondary: '#008000',
    visualizerColors: ['#00ff00', '#ffff00', '#ff0000'],
    buttonBg: '#c0c0c0',
    buttonText: '#000000',
    cdOuter: '#1a1a2e',
    cdInner: '#16213e',
    glow: 'rgba(0, 255, 0, 0.3)',
  },
  winamp: {
    name: 'Winamp',
    bg: '#232323',
    bgSecondary: '#0a0a0a',
    text: '#00ff00',
    textSecondary: '#8bc34a',
    accent: '#ff6600',
    accentSecondary: '#cc5500',
    visualizerColors: ['#00ff00', '#88ff00', '#ffff00'],
    buttonBg: '#3a3a3a',
    buttonText: '#00ff00',
    cdOuter: '#1a1a1a',
    cdInner: '#0d0d0d',
    glow: 'rgba(255, 102, 0, 0.4)',
  },
  silver: {
    name: 'Silver',
    bg: 'linear-gradient(180deg, #e8e8e8 0%, #c0c0c0 100%)',
    bgSecondary: '#f0f0f0',
    text: '#000000',
    textSecondary: '#404040',
    accent: '#0078d4',
    accentSecondary: '#005a9e',
    visualizerColors: ['#0078d4', '#00a8ff', '#80d4ff'],
    buttonBg: '#e0e0e0',
    buttonText: '#000000',
    cdOuter: '#d0d0d0',
    cdInner: '#a0a0a0',
    glow: 'rgba(0, 120, 212, 0.3)',
  },
  synthwave: {
    name: 'Synthwave',
    bg: 'linear-gradient(180deg, #1a0a2e 0%, #16213e 100%)',
    bgSecondary: '#0d0620',
    text: '#ff00ff',
    textSecondary: '#00ffff',
    accent: '#ff00ff',
    accentSecondary: '#00ffff',
    visualizerColors: ['#ff00ff', '#ff66ff', '#00ffff'],
    buttonBg: '#2d1b4e',
    buttonText: '#ff00ff',
    cdOuter: '#1a0a2e',
    cdInner: '#0d0620',
    glow: 'rgba(255, 0, 255, 0.5)',
  },
};

// Visualizer modes
type VisualizerMode = 'bars' | 'wave' | 'spectrum';

// Spinning CD Component
// Album Art Component
const AlbumArt = ({ 
  albumArt, 
  isPlaying, 
  skin 
}: { 
  albumArt: string; 
  isPlaying: boolean; 
  skin: typeof MEDIA_PLAYER_SKINS[MediaPlayerSkin];
}) => {
  return (
    <div className="relative w-20 h-20 shrink-0">
      {/* Glow effect when playing */}
      <div 
        className="absolute -inset-1 rounded blur-md transition-opacity duration-300"
        style={{ 
          backgroundColor: skin.glow,
          opacity: isPlaying ? 0.6 : 0,
        }}
      />
      
      {/* Album art image */}
      <div 
        className="relative w-full h-full overflow-hidden rounded"
        style={{
          border: '2px solid #404040',
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.4)`,
        }}
      >
        <img 
          src={albumArt} 
          alt="Album art"
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
          }}
        />
        
        {/* Reflection overlay for jewel case effect */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 40%, rgba(0,0,0,0.1) 100%)',
          }}
        />
      </div>
    </div>
  );
};

// Enhanced Visualizer Component
const Visualizer = ({ 
  isPlaying, 
  mode, 
  skin,
  onModeChange,
}: { 
  isPlaying: boolean; 
  mode: VisualizerMode;
  skin: typeof MEDIA_PLAYER_SKINS[MediaPlayerSkin];
  onModeChange: () => void;
}) => {
  const [bars, setBars] = useState<number[]>(Array(24).fill(10));
  const [wave, setWave] = useState<number[]>(Array(40).fill(0));
  const [peaks, setPeaks] = useState<number[]>(Array(24).fill(10));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        if (mode === 'bars' || mode === 'spectrum') {
          setBars(prev => prev.map((_, i) => {
            // Simulate frequency distribution - bass heavy on left
            const baseHeight = mode === 'spectrum' 
              ? Math.max(10, 80 - i * 2) 
              : 50;
            return Math.max(10, baseHeight + (Math.random() - 0.5) * 60);
          }));
          // Update peaks with decay
          setPeaks(prev => prev.map((peak, i) => {
            const newBar = bars[i] || 50;
            if (newBar > peak) return newBar;
            return Math.max(10, peak - 2);
          }));
        } else if (mode === 'wave') {
          setWave(() => {
            const time = Date.now() / 1000; // Much slower time progression
            return Array(40).fill(0).map((_, i) => {
              // Gentle overlapping sine waves for smooth movement
              const wave1 = Math.sin(i * 0.15 + time * 0.8) * 20;
              const wave2 = Math.sin(i * 0.08 + time * 0.5) * 10;
              return 50 + wave1 + wave2;
            });
          });
        }
      }, 60);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setBars(Array(24).fill(10));
      setWave(Array(40).fill(50));
      setPeaks(Array(24).fill(10));
    }
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, mode, bars]);

  const getBarColor = (index: number, height: number) => {
    const ratio = height / 100;
    if (ratio > 0.8) return skin.visualizerColors[2];
    if (ratio > 0.5) return skin.visualizerColors[1];
    return skin.visualizerColors[0];
  };

  return (
    <div 
      className="relative h-16 mx-2 flex items-end justify-center cursor-pointer overflow-hidden"
      style={{ 
        backgroundColor: skin.bgSecondary, 
        border: '2px inset #808080',
        borderRadius: '2px',
      }}
      onClick={onModeChange}
      title="Click to change visualizer mode"
    >
      {/* Scanline effect */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
        }}
      />
      
      {mode === 'wave' ? (
        // Oscilloscope wave
        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            d={`M 0 ${wave[0]} ${wave.map((v, i) => `L ${(i / (wave.length - 1)) * 100} ${v}`).join(' ')}`}
            fill="none"
            stroke={skin.visualizerColors[0]}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            style={{
              filter: `drop-shadow(0 0 3px ${skin.visualizerColors[0]})`,
            }}
          />
        </svg>
      ) : (
        // Bars or Spectrum
        <div className="flex items-end gap-px h-full w-full px-1 pb-1">
          {bars.map((height, i) => (
            <div key={i} className="relative flex-1 flex flex-col justify-end h-full">
              {/* Peak indicator */}
              {mode === 'spectrum' && (
                <div 
                  className="absolute w-full h-0.5"
                  style={{
                    bottom: `${peaks[i]}%`,
                    backgroundColor: skin.visualizerColors[2],
                    boxShadow: `0 0 4px ${skin.visualizerColors[2]}`,
                  }}
                />
              )}
              {/* Bar */}
              <div
                className="w-full transition-all duration-50"
                style={{
                  height: `${height}%`,
                  backgroundColor: getBarColor(i, height),
                  borderRadius: '1px 1px 0 0',
                  boxShadow: isPlaying ? `0 0 4px ${getBarColor(i, height)}` : 'none',
                }}
              />
            </div>
          ))}
        </div>
      )}
      
      {/* Mode indicator */}
      <div 
        className="absolute bottom-0.5 right-1 text-[8px] uppercase opacity-50"
        style={{ color: skin.text }}
      >
        {mode}
      </div>
    </div>
  );
};

// Main Media Player Component
const MediaPlayerContent = ({ currentOS = 'win95' }) => {
  const { 
    queue, 
    currentTrack, 
    currentIndex,
    isPlaying, 
    position, 
    duration,
    volume, 
    isLoading,
    error,
    setQueue,
  } = useAudioStore();
  
  const {
    togglePlay,
    stop,
    nextTrack,
    prevTrack,
    playTrack,
    setVolume,
    seek,
  } = useAudioEngine();

  const [skin, setSkin] = useState<MediaPlayerSkin>('classic');
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('wave');
  const [currentAlbum, setCurrentAlbum] = useState<AlbumId>('1995-hits');
  const [myMusicTracks, setMyMusicTracks] = useState<Track[]>([]);
  const [showAlbumMenu, setShowAlbumMenu] = useState(false);
  const [isLoadingTracks, setIsLoadingTracks] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const albumMenuRef = useRef<HTMLDivElement>(null);
  const dbRef = useRef<IDBDatabase | null>(null);

  // OS-specific styling for classic skin
  const isXP = currentOS === 'winxp';
  
  const currentSkin = MEDIA_PLAYER_SKINS[skin];
  
  // IndexedDB helpers for persisting uploaded music
  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MediaPlayerDB', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('tracks')) {
          db.createObjectStore('tracks', { keyPath: 'id' });
        }
      };
    });
  };
  
  const saveTrackToDB = async (track: Track, audioBlob: Blob) => {
    const db = dbRef.current || await openDB();
    dbRef.current = db;
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readwrite');
      const store = transaction.objectStore('tracks');
      const request = store.put({ 
        id: track.id, 
        track: { ...track, audioUrl: undefined }, // Don't store blob URL
        audioBlob 
      });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  };
  
  const loadTracksFromDB = async (): Promise<Track[]> => {
    try {
      const db = dbRef.current || await openDB();
      dbRef.current = db;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const store = transaction.objectStore('tracks');
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const results = request.result;
          const tracks: Track[] = results.map((item: { track: Track; audioBlob: Blob }) => ({
            ...item.track,
            audioUrl: URL.createObjectURL(item.audioBlob),
          }));
          resolve(tracks);
        };
      });
    } catch (e) {
      console.error('Failed to load tracks from DB:', e);
      return [];
    }
  };
  
  const deleteTrackFromDB = async (trackId: string) => {
    try {
      const db = dbRef.current || await openDB();
      dbRef.current = db;
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readwrite');
        const store = transaction.objectStore('tracks');
        const request = store.delete(trackId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (e) {
      console.error('Failed to delete track from DB:', e);
    }
  };

  // Initialize queue on mount
  useEffect(() => {
    if (currentAlbum === '1995-hits') {
      setQueue(PLAYLIST_1995);
    } else {
      setQueue(myMusicTracks);
    }
  }, [currentAlbum, myMusicTracks, setQueue]);

  // Load skin preference and my music from localStorage/IndexedDB
  useEffect(() => {
    const savedSkin = localStorage.getItem('mediaPlayerSkin') as MediaPlayerSkin;
    if (savedSkin && MEDIA_PLAYER_SKINS[savedSkin]) {
      setSkin(savedSkin);
    }
    
    // Load saved album preference
    const savedAlbum = localStorage.getItem('mediaPlayerAlbum') as AlbumId;
    if (savedAlbum) {
      setCurrentAlbum(savedAlbum);
    }
    
    // Load saved tracks from IndexedDB
    loadTracksFromDB().then((tracks) => {
      setMyMusicTracks(tracks);
      setIsLoadingTracks(false);
    }).catch(() => {
      setIsLoadingTracks(false);
    });
    
    // Cleanup blob URLs on unmount
    return () => {
      myMusicTracks.forEach(track => {
        if (track.audioUrl) {
          URL.revokeObjectURL(track.audioUrl);
        }
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Close album menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (albumMenuRef.current && !albumMenuRef.current.contains(e.target as Node)) {
        setShowAlbumMenu(false);
      }
    };
    if (showAlbumMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAlbumMenu]);
  
  // Handle album change
  const handleAlbumChange = (albumId: AlbumId) => {
    // Stop current playback when switching albums
    stop();
    setCurrentAlbum(albumId);
    localStorage.setItem('mediaPlayerAlbum', albumId);
  };
  
  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const newTracks: Track[] = [];
    const trackBlobs: { track: Track; blob: Blob }[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('audio/')) continue;
      
      // Create blob URL for the audio file
      const audioBlob = file;
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Get duration from audio element
      const audio = new Audio(audioUrl);
      await new Promise<void>((resolve) => {
        audio.addEventListener('loadedmetadata', () => {
          const durationSec = Math.floor(audio.duration);
          const mins = Math.floor(durationSec / 60);
          const secs = durationSec % 60;
          
          // Parse filename for title (remove extension)
          const title = file.name.replace(/\.[^/.]+$/, '');
          
          const track: Track = {
            id: `local-${Date.now()}-${i}`,
            title,
            artist: 'Unknown Artist',
            duration: `${mins}:${String(secs).padStart(2, '0')}`,
            durationSec,
            source: 'local',
            audioUrl,
          };
          
          newTracks.push(track);
          trackBlobs.push({ track, blob: audioBlob });
          resolve();
        });
        audio.addEventListener('error', () => resolve());
      });
    }
    
    if (newTracks.length > 0) {
      // Save to IndexedDB
      for (const { track, blob } of trackBlobs) {
        await saveTrackToDB(track, blob);
      }
      
      setMyMusicTracks(prev => [...prev, ...newTracks]);
      // Switch to My Music album if not already there
      if (currentAlbum !== 'my-music') {
        handleAlbumChange('my-music');
      }
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  // Remove track from My Music
  const removeTrack = async (trackId: string) => {
    // Delete from IndexedDB
    await deleteTrackFromDB(trackId);
    
    setMyMusicTracks(prev => {
      const track = prev.find(t => t.id === trackId);
      // Revoke blob URL to free memory
      if (track?.audioUrl) {
        URL.revokeObjectURL(track.audioUrl);
      }
      return prev.filter(t => t.id !== trackId);
    });
  };

  // Save skin preference
  const changeSkin = (newSkin: MediaPlayerSkin) => {
    setSkin(newSkin);
    localStorage.setItem('mediaPlayerSkin', newSkin);
    // Dispatch custom event for MiniPlayer to sync
    window.dispatchEvent(new CustomEvent('skinChange', { detail: newSkin }));
  };

  // Cycle visualizer mode
  const cycleVisualizerMode = () => {
    const modes: VisualizerMode[] = ['bars', 'wave', 'spectrum'];
    const currentIndex = modes.indexOf(visualizerMode);
    setVisualizerMode(modes[(currentIndex + 1) % modes.length]);
  };

  // Format seconds to m:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  // Calculate progress percentage
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  // Handle seek click on progress bar
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    seek(percent * duration);
  };

  // Get album art URL from YouTube thumbnail
  // Get album art - YouTube thumbnail or fallback for local
  const getAlbumArt = (track: Track) => {
    if (track.albumArt) return track.albumArt;
    if (track.source === 'youtube' && track.youtubeId) {
      return `https://img.youtube.com/vi/${track.youtubeId}/mqdefault.jpg`;
    }
    // Fallback music icon for local files
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23888"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
  };

  // Use queue if available, otherwise use static playlist for display
  const displayPlaylist = queue.length > 0 ? queue : (currentAlbum === '1995-hits' ? PLAYLIST_1995 : []);
  const displayTrack = currentTrack || displayPlaylist[0];
  const displayIndex = currentIndex >= 0 ? currentIndex : 0;
  const albumArt = displayTrack ? getAlbumArt(displayTrack) : '';

  // Classic skin colors based on OS (XP styling applies to all skins)
  const classicBgColor = skin === 'classic' && isXP ? colorsXP.windowBg : '#c0c0c0';
  const classicBorderColor = isXP ? '#ACA899' : '#808080';
  const xpBorderStyle = isXP ? raisedXP : raised;
  const classicBorderStyle = skin === 'classic' || skin === 'silver' ? xpBorderStyle : {};

  // Button style based on skin
  const buttonStyle = {
    backgroundColor: skin === 'classic' && isXP ? colorsXP.windowBg : currentSkin.buttonBg,
    color: currentSkin.buttonText,
    border: skin === 'winamp' 
      ? '1px solid #555' 
      : undefined,
    boxShadow: skin === 'winamp'
      ? 'inset 1px 1px 0 #4a4a4a, inset -1px -1px 0 #1a1a1a'
      : undefined,
    ...(skin !== 'winamp' && skin !== 'synthwave' ? classicBorderStyle : {}),
    borderRadius: isXP ? '3px' : undefined,
  };

  return (
    <div 
      className="h-full flex flex-col overflow-hidden"
      style={{ 
        background: skin === 'classic' && isXP ? colorsXP.windowBg : currentSkin.bg, 
        color: currentSkin.text,
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.flac"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />
      
      {/* Menu bar */}
      <div 
        className="flex items-center gap-2 px-1 py-0.5 text-[11px]"
        style={{ 
          backgroundColor: skin === 'winamp' ? '#2a2a2a' : (skin === 'synthwave' ? '#1a0a2e' : classicBgColor),
          borderBottom: `1px solid ${classicBorderColor}`,
        }}
      >
        {/* Albums dropdown */}
        <div className="relative" ref={albumMenuRef}>
          <button
            onClick={() => setShowAlbumMenu(!showAlbumMenu)}
            className="px-2 py-0.5 hover:bg-[#000080] hover:text-white"
            style={{ 
              color: skin === 'winamp' || skin === 'synthwave' ? currentSkin.text : '#000',
            }}
          >
            Albums ▾
          </button>
          
          {/* Dropdown menu */}
          {showAlbumMenu && (
            <div 
              className={`absolute top-full left-0 z-50 min-w-[180px] py-0.5 shadow-lg ${isXP ? 'rounded' : ''}`}
              style={{ 
                backgroundColor: skin === 'winamp' ? '#2a2a2a' : (skin === 'synthwave' ? '#1a0a2e' : classicBgColor),
                border: `1px solid ${classicBorderColor}`,
              }}
            >
              {ALBUMS.map((album) => (
                <button
                  key={album.id}
                  onClick={() => {
                    handleAlbumChange(album.id);
                    setShowAlbumMenu(false);
                  }}
                  className="w-full px-3 py-1 text-left flex items-center gap-2 hover:bg-[#000080] hover:text-white"
                  style={{ 
                    color: skin === 'winamp' || skin === 'synthwave' ? currentSkin.text : '#000',
                    backgroundColor: currentAlbum === album.id ? (skin === 'winamp' || skin === 'synthwave' ? currentSkin.accent + '40' : '#e0e0e0') : 'transparent',
                  }}
                >
                  <span>{album.icon}</span>
                  <span className="flex-1">{album.name}</span>
                  {currentAlbum === album.id && <span>✓</span>}
                </button>
              ))}
              
              {/* Separator */}
              <div className="my-0.5 border-t border-[#808080]" />
              
              {/* Add music option */}
              <button
                onClick={() => {
                  fileInputRef.current?.click();
                  setShowAlbumMenu(false);
                }}
                className="w-full px-3 py-1 text-left flex items-center gap-2 hover:bg-[#000080] hover:text-white"
                style={{ 
                  color: skin === 'winamp' || skin === 'synthwave' ? currentSkin.text : '#000',
                }}
              >
                <span>➕</span>
                <span>Add Music Files...</span>
              </button>
            </div>
          )}
        </div>
        
        {/* Skin selector dropdown-style */}
        <div className="relative group">
          <button
            className="px-2 py-0.5 hover:bg-[#000080] hover:text-white"
            style={{ 
              color: skin === 'winamp' || skin === 'synthwave' ? currentSkin.text : '#000',
            }}
          >
            Style ▾
          </button>
          
          {/* Style dropdown on hover */}
          <div 
            className={`absolute top-full left-0 z-50 min-w-[100px] py-0.5 shadow-lg hidden group-hover:block ${isXP ? 'rounded' : ''}`}
            style={{ 
              backgroundColor: skin === 'winamp' ? '#2a2a2a' : (skin === 'synthwave' ? '#1a0a2e' : classicBgColor),
              border: `1px solid ${classicBorderColor}`,
            }}
          >
            {(Object.keys(MEDIA_PLAYER_SKINS) as MediaPlayerSkin[]).map((s) => (
              <button
                key={s}
                onClick={() => changeSkin(s)}
                className="w-full px-3 py-1 text-left hover:bg-[#000080] hover:text-white"
                style={{ 
                  color: skin === 'winamp' || skin === 'synthwave' ? currentSkin.text : '#000',
                  backgroundColor: skin === s ? (skin === 'winamp' || skin === 'synthwave' ? currentSkin.accent + '40' : '#e0e0e0') : 'transparent',
                }}
              >
                {MEDIA_PLAYER_SKINS[s].name}
                {skin === s && ' ✓'}
              </button>
            ))}
          </div>
        </div>
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Current album indicator */}
        <span 
          className="text-[10px] opacity-70 px-2"
          style={{ color: skin === 'winamp' || skin === 'synthwave' ? currentSkin.textSecondary : '#404040' }}
        >
          {ALBUMS.find(a => a.id === currentAlbum)?.icon} {ALBUMS.find(a => a.id === currentAlbum)?.name}
        </span>
      </div>

      {/* Main display area with CD and visualizer */}
      <div className="flex gap-2 p-2">
        {/* Album Art - only show if there are tracks */}
        {displayPlaylist.length > 0 && (
          <AlbumArt 
            albumArt={albumArt} 
            isPlaying={isPlaying} 
            skin={currentSkin}
          />
        )}
        
        {/* Visualizer and track info */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <Visualizer 
            isPlaying={isPlaying} 
            mode={visualizerMode}
            skin={currentSkin}
            onModeChange={cycleVisualizerMode}
          />
          
          {/* Track info - only show if there are tracks */}
          {displayPlaylist.length > 0 ? (
            <div 
              className="px-1 overflow-hidden"
              style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif' }}
            >
              <div 
                className="text-xs font-bold truncate"
                style={{ color: currentSkin.text }}
                title={displayTrack?.title}
              >
                {isLoading ? 'Loading...' : displayTrack?.title || 'No track'}
              </div>
              <div 
                className="text-[10px] truncate"
                style={{ color: currentSkin.textSecondary }}
              >
                {displayTrack?.artist || ''}
              </div>
              {error && (
                <div className="text-[10px] text-red-400 truncate">{error}</div>
              )}
            </div>
          ) : (
            <div 
              className="px-1 text-center"
              style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', color: currentSkin.textSecondary }}
            >
              <div className="text-[10px]">No tracks loaded</div>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-2 flex items-center gap-2 text-[10px]" style={{ color: currentSkin.textSecondary }}>
        <span className="w-8 text-right">{formatTime(position)}</span>
        <div 
          className="flex-1 h-2 cursor-pointer relative overflow-hidden"
          style={{ 
            backgroundColor: currentSkin.bgSecondary, 
            border: '1px solid #404040',
            borderRadius: '1px',
          }}
          onClick={handleSeek}
        >
          <div 
            className="h-full transition-all duration-100"
            style={{ 
              width: `${progress}%`, 
              backgroundColor: currentSkin.accent,
              boxShadow: isPlaying ? `0 0 6px ${currentSkin.glow}` : 'none',
            }} 
          />
        </div>
        <span className="w-8">{displayTrack?.duration || '0:00'}</span>
      </div>

      {/* Controls */}
      <div className="flex justify-center items-center gap-1 p-2">
        <button 
          onClick={prevTrack} 
          className="w-8 h-6 text-xs flex items-center justify-center"
          style={buttonStyle}
        >
          ⏮
        </button>
        <button 
          onClick={stop} 
          className="w-8 h-6 text-xs flex items-center justify-center"
          style={buttonStyle}
        >
          ⏹
        </button>
        <button 
          onClick={togglePlay} 
          className="w-12 h-7 text-sm font-bold flex items-center justify-center"
          style={{
            ...buttonStyle,
            boxShadow: isPlaying 
              ? `0 0 10px ${currentSkin.glow}, ${buttonStyle.boxShadow || ''}`
              : buttonStyle.boxShadow,
          }}
          disabled={isLoading}
        >
          {isLoading ? '⏳' : isPlaying ? '⏸' : '▶'}
        </button>
        <button 
          onClick={nextTrack} 
          className="w-8 h-6 text-xs flex items-center justify-center"
          style={buttonStyle}
        >
          ⏭
        </button>
      </div>

      {/* Volume */}
      <div className="px-2 flex items-center gap-2 text-[10px]" style={{ color: currentSkin.textSecondary }}>
        <span>🔊</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          className="flex-1 h-1"
          style={{
            accentColor: currentSkin.accent,
          }}
        />
        <span className="w-8 text-right">{Math.round(volume * 100)}%</span>
      </div>

      {/* Playlist */}
      <div 
        className={`flex-1 mx-2 mb-2 mt-1 overflow-auto ${isXP ? 'rounded' : ''}`}
        style={{ 
          backgroundColor: skin === 'winamp' ? '#0a0a0a' : (skin === 'synthwave' ? '#0d0620' : '#fff'),
          color: skin === 'winamp' || skin === 'synthwave' ? currentSkin.text : '#000',
          border: isXP ? `1px solid ${classicBorderColor}` : '2px inset #808080',
        }}
      >
        {/* Empty state for My Music */}
        {currentAlbum === 'my-music' && displayPlaylist.length === 0 && (
          <div 
            className="flex flex-col items-center justify-center h-full text-center p-4"
            style={{ color: currentSkin.textSecondary }}
          >
            {isLoadingTracks ? (
              <>
                <div className="text-2xl mb-2">⏳</div>
                <div className="text-[11px]">Loading tracks...</div>
              </>
            ) : (
              <>
                <div className="text-2xl mb-2">📁</div>
                <div className="text-[11px] mb-1">No tracks yet</div>
                <div className="text-[10px] opacity-70">Go to Albums → Add Music Files...</div>
              </>
            )}
          </div>
        )}
        {displayPlaylist.map((track, i) => (
          <div
            key={track.id}
            onClick={() => playTrack(i)}
            className="px-2 py-0.5 text-[10px] cursor-pointer flex items-center gap-2 transition-colors"
            style={{ 
              fontFamily: '"MS Sans Serif", Tahoma, sans-serif',
              backgroundColor: i === displayIndex && currentTrack 
                ? currentSkin.accent 
                : 'transparent',
              color: i === displayIndex && currentTrack 
                ? (skin === 'silver' ? '#fff' : currentSkin.bgSecondary)
                : (skin === 'winamp' || skin === 'synthwave' ? currentSkin.textSecondary : '#000'),
            }}
          >
            {/* Mini album art */}
            <img 
              src={getAlbumArt(track)}
              alt=""
              className="w-5 h-5 object-cover rounded-sm shrink-0"
              style={{ 
                border: `1px solid ${currentSkin.textSecondary}40`,
              }}
            />
            {/* Source indicator */}
            <span className="text-[8px] opacity-50">
              {track.source === 'local' ? '📁' : '▶️'}
            </span>
            <span className="truncate flex-1">{track.artist} - {track.title}</span>
            <span 
              className="shrink-0"
              style={{ 
                color: i === displayIndex && currentTrack 
                  ? (skin === 'silver' ? '#ddd' : currentSkin.textSecondary)
                  : currentSkin.textSecondary 
              }}
            >
              {track.duration}
            </span>
            {/* Remove button for My Music tracks */}
            {currentAlbum === 'my-music' && track.source === 'local' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTrack(track.id);
                }}
                className="ml-1 w-4 h-4 text-[10px] flex items-center justify-center hover:bg-red-500 hover:text-white rounded"
                style={{ color: currentSkin.textSecondary }}
                title="Remove track"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Mini Player Component - shows when media player is minimized
const MiniPlayer = ({ 
  currentTrack, 
  isPlaying, 
  position, 
  duration,
  onTogglePlay, 
  onNext, 
  onPrev,
  onRestore,
}: { 
  currentTrack: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onRestore: () => void;
}) => {
  // Get skin from localStorage to match main player
  const [skinKey, setSkinKey] = useState<MediaPlayerSkin>('classic');
  
  useEffect(() => {
    const savedSkin = localStorage.getItem('mediaPlayerSkin') as MediaPlayerSkin;
    if (savedSkin && MEDIA_PLAYER_SKINS[savedSkin]) {
      setSkinKey(savedSkin);
    }
    
    // Listen for skin changes from main player
    const handleSkinChange = (e: CustomEvent<MediaPlayerSkin>) => {
      if (e.detail && MEDIA_PLAYER_SKINS[e.detail]) {
        setSkinKey(e.detail);
      }
    };
    window.addEventListener('skinChange', handleSkinChange as EventListener);
    return () => window.removeEventListener('skinChange', handleSkinChange as EventListener);
  }, []);
  
  const skin = MEDIA_PLAYER_SKINS[skinKey];
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  
  // Get album art based on track source
  const getTrackArt = () => {
    if (!currentTrack) return '';
    if (currentTrack.albumArt) return currentTrack.albumArt;
    if (currentTrack.source === 'youtube' && currentTrack.youtubeId) {
      return `https://img.youtube.com/vi/${currentTrack.youtubeId}/mqdefault.jpg`;
    }
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23888"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
  };
  const albumArt = getTrackArt();

  const buttonStyle = {
    backgroundColor: skin.buttonBg,
    color: skin.buttonText,
    border: skinKey === 'winamp' ? '1px solid #555' : undefined,
    boxShadow: skinKey === 'winamp'
      ? 'inset 1px 1px 0 #4a4a4a, inset -1px -1px 0 #1a1a1a'
      : undefined,
    ...(skinKey !== 'winamp' && skinKey !== 'synthwave' ? raised : {}),
  };

  return (
    <div 
      className="fixed bottom-10 right-2 z-50 flex items-center gap-2 p-2 rounded shadow-lg cursor-pointer"
      style={{
        background: skin.bg,
        border: '2px outset #c0c0c0',
        minWidth: '280px',
        boxShadow: `0 0 15px ${skin.glow}`,
      }}
      onClick={onRestore}
      title="Click to restore player"
    >
      {/* Album art */}
      <div className="w-10 h-10 rounded overflow-hidden shrink-0" style={{ border: `1px solid ${skin.textSecondary}40` }}>
        <img 
          src={albumArt} 
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
          }}
        />
      </div>
      
      {/* Track info and controls */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold truncate" style={{ fontFamily: '"MS Sans Serif", Tahoma, sans-serif', color: skin.text }}>
          {currentTrack?.title || 'No track'}
        </div>
        <div className="text-[10px] truncate" style={{ color: skin.textSecondary }}>
          {currentTrack?.artist || ''}
        </div>
        {/* Progress bar */}
        <div className="h-1 mt-1 rounded-sm overflow-hidden" style={{ backgroundColor: skin.bgSecondary }}>
          <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: skin.accent }} />
        </div>
      </div>
      
      {/* Controls */}
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button 
          onClick={onPrev}
          className="w-6 h-6 text-[10px] flex items-center justify-center"
          style={buttonStyle}
        >
          ⏮
        </button>
        <button 
          onClick={onTogglePlay}
          className="w-6 h-6 text-[10px] flex items-center justify-center"
          style={buttonStyle}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button 
          onClick={onNext}
          className="w-6 h-6 text-[10px] flex items-center justify-center"
          style={buttonStyle}
        >
          ⏭
        </button>
      </div>
    </div>
  );
};

// Main component
export default function Windows95Portfolio() {
  const { isMobile, isTouch, layoutMode, inputMode } = useDeviceMode();
  
  // Audio state for mini player and close handling
  const { currentTrack, isPlaying, position, duration } = useAudioStore();
  const { togglePlay, stop, nextTrack, prevTrack } = useAudioEngine();
  const [isBooting, setIsBooting] = useState(true);
  const [showClippy, setShowClippy] = useState(false);
  const [windows, setWindows] = useState({
    about: { isOpen: true, isMinimized: false, isMaximized: false, position: { x: 60, y: 40 }, size: { width: 340, height: 340 }, zIndex: 2 },
    projects: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 140, y: 70 }, size: { width: 380, height: 300 }, zIndex: 0 },
    resume: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 160, y: 60 }, size: { width: 400, height: 450 }, zIndex: 0 },
    contact: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 180, y: 90 }, size: { width: 340, height: 360 }, zIndex: 0 },
    terminal: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 100, y: 100 }, size: { width: 440, height: 300 }, zIndex: 0 },
    notepad: { isOpen: true, isMinimized: false, isMaximized: false, position: { x: 380, y: 50 }, size: { width: 300, height: 360 }, zIndex: 1 },
    'vmware-case': { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 50, y: 40 }, size: { width: 480, height: 450 }, zIndex: 0 },
    'global-search-gallery': { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 540, y: 40 }, size: { width: 420, height: 450 }, zIndex: 0 },
    'island-health-case': { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 120, y: 50 }, size: { width: 480, height: 450 }, zIndex: 0 },
    minesweeper: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 200, y: 60 }, size: { width: 164, height: 265 }, zIndex: 0 },
    paint: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 120, y: 50 }, size: { width: 500, height: 400 }, zIndex: 0 },
    media: { isOpen: false, isMinimized: false, isMaximized: false, position: { x: 250, y: 80 }, size: { width: 320, height: 420 }, zIndex: 0 },
  });
  
  const [topZIndex, setTopZIndex] = useState(2);
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState(null);
  const [currentOS, setCurrentOS] = useState<'win95' | 'winxp'>('win95');

  // Desktop grid system
  const { gridSize, taskbarHeight, cellToPixels, pixelsToCell } = useDesktopGrid(isMobile);
  
  // Icon positions state with localStorage persistence
  const [iconPositions, setIconPositions] = useState<Record<string, { col: number; row: number }>>(() => {
    if (typeof window === 'undefined') return {};
    const saved = localStorage.getItem('desktopIconPositions');
    return saved ? JSON.parse(saved) : {};
  });

  // Save icon positions to localStorage
  useEffect(() => {
    if (Object.keys(iconPositions).length > 0) {
      localStorage.setItem('desktopIconPositions', JSON.stringify(iconPositions));
    }
  }, [iconPositions]);

  // Collision detection: check if a cell is occupied
  const isCellOccupied = useCallback((col: number, row: number, excludeId?: string) => {
    return Object.entries(iconPositions).some(
      ([id, pos]) => id !== excludeId && pos.col === col && pos.row === row
    );
  }, [iconPositions]);

  // Find nearest empty cell (spiral search)
  const findNearestEmptyCell = useCallback((startCol: number, startRow: number, excludeId: string) => {
    // First check the target cell
    if (!isCellOccupied(startCol, startRow, excludeId)) {
      return { col: startCol, row: startRow };
    }

    // Spiral outward to find empty cell
    for (let distance = 1; distance < Math.max(gridSize.cols, gridSize.rows); distance++) {
      for (let dc = -distance; dc <= distance; dc++) {
        for (let dr = -distance; dr <= distance; dr++) {
          if (Math.abs(dc) !== distance && Math.abs(dr) !== distance) continue; // Only check perimeter
          const col = startCol + dc;
          const row = startRow + dr;
          if (col >= 0 && col < gridSize.cols && row >= 0 && row < gridSize.rows) {
            if (!isCellOccupied(col, row, excludeId)) {
              return { col, row };
            }
          }
        }
      }
    }
    return { col: startCol, row: startRow }; // Fallback
  }, [gridSize, isCellOccupied]);

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
  const desktopIconSizeXP = isMobile ? 48 : 40;

  // OS-aware icon helper
  const getIcon = (type: string, size: number) => {
    return currentOS === 'winxp' 
      ? <XPIcon type={type} size={size} /> 
      : <PixelIcon type={type} size={size} />;
  };

  const currentDesktopIconSize = currentOS === 'winxp' ? desktopIconSizeXP : desktopIconSize;

  const desktopIcons = [
    { id: 'about', label: 'About Me', icon: getIcon('user', currentDesktopIconSize) },
    { id: 'recycle', label: 'Recycle Bin', icon: getIcon('recycle', currentDesktopIconSize) },
    { id: 'projects', label: 'My Projects', icon: getIcon('folder', currentDesktopIconSize) },
    { id: 'resume', label: 'Resume', icon: getIcon('notepad', currentDesktopIconSize) },
    { id: 'contact', label: 'Contact', icon: getIcon('mail', currentDesktopIconSize) },
    { id: 'terminal', label: currentOS === 'winxp' ? 'Command Prompt' : 'MS-DOS', icon: getIcon('terminal', currentDesktopIconSize) },
    { id: 'notepad', label: 'README', icon: getIcon('notepad', currentDesktopIconSize) },
    { id: 'minesweeper', label: 'Minesweeper', icon: getIcon('minesweeper', currentDesktopIconSize) },
    { id: 'paint', label: 'Paint', icon: getIcon('paint', currentDesktopIconSize) },
    { id: 'media', label: currentOS === 'winxp' ? 'Windows Media Player' : 'Media Player', icon: getIcon('media', currentDesktopIconSize) },
  ];

  // Initialize default icon positions (column-first order like Windows)
  useEffect(() => {
    if (gridSize.rows === 0) return; // Wait for grid to be calculated
    
    const hasPositions = desktopIcons.every(icon => iconPositions[icon.id]);
    if (!hasPositions) {
      const defaultPositions: Record<string, { col: number; row: number }> = {};
      desktopIcons.forEach((icon, index) => {
        // Fill columns first (top to bottom), then move right
        const col = Math.floor(index / gridSize.rows);
        const row = index % gridSize.rows;
        defaultPositions[icon.id] = { col, row };
      });
      setIconPositions(defaultPositions);
    }
  }, [gridSize.rows, desktopIcons.length]);

  // Handle window resize - keep icons within valid grid bounds
  useEffect(() => {
    if (gridSize.cols === 0 || gridSize.rows === 0) return;
    if (Object.keys(iconPositions).length === 0) return;

    let needsUpdate = false;
    const validatedPositions = { ...iconPositions };

    Object.entries(validatedPositions).forEach(([id, pos]) => {
      if (pos.col >= gridSize.cols || pos.row >= gridSize.rows) {
        needsUpdate = true;
        const newPos = findNearestEmptyCell(
          Math.min(pos.col, gridSize.cols - 1),
          Math.min(pos.row, gridSize.rows - 1),
          id
        );
        validatedPositions[id] = newPos;
      }
    });

    if (needsUpdate) {
      setIconPositions(validatedPositions);
    }
  }, [gridSize.cols, gridSize.rows]);

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

  // Resize handler for Minesweeper
  const handleMinesweeperResize = useCallback((width: number, height: number) => {
    setWindows(prev => ({
      ...prev,
      minesweeper: { ...prev.minesweeper, size: { width, height } }
    }));
  }, []);

  // Apps array defined after openApp so it can be passed as prop
  const apps = [
    { id: 'about', title: 'About Me', menuIcon: getIcon('user', iconSize), content: <AboutContent currentOS={currentOS} /> },
    { id: 'projects', title: 'My Projects', menuIcon: getIcon('folder', iconSize), content: <ProjectsContent onOpenProject={openApp} currentOS={currentOS} /> },
    { id: 'resume', title: 'Resume.doc - Microsoft Word', menuIcon: getIcon('notepad', iconSize), content: <ResumeContent currentOS={currentOS} /> },
    { id: 'contact', title: 'Contact', menuIcon: getIcon('mail', iconSize), content: <ContactContent currentOS={currentOS} /> },
    { id: 'terminal', title: currentOS === 'winxp' ? 'Command Prompt' : 'MS-DOS Prompt', menuIcon: getIcon('terminal', iconSize), content: <TerminalContent currentOS={currentOS} /> },
    { id: 'notepad', title: 'README.txt - Notepad', menuIcon: getIcon('notepad', iconSize), content: <NotepadContent currentOS={currentOS} /> },
    { id: 'vmware-case', title: 'GlobalSearch.txt - Notepad', menuIcon: getIcon('notepad', iconSize), content: <VMwareCaseStudy currentOS={currentOS} /> },
    { id: 'global-search-gallery', title: 'Global Search - Screenshots', menuIcon: getIcon('folder', iconSize), content: <GlobalSearchGallery currentOS={currentOS} />, hideMenuBar: true },
    { id: 'island-health-case', title: 'IslandHealth.txt - Notepad', menuIcon: getIcon('notepad', iconSize), content: <IslandHealthCaseStudy currentOS={currentOS} /> },
    { id: 'minesweeper', title: 'Minesweeper', menuIcon: getIcon('minesweeper', iconSize), content: <Minesweeper currentOS={currentOS} onResize={handleMinesweeperResize} />, hideMenuBar: true, noScroll: true, noStatusBar: true },
    { id: 'paint', title: 'untitled - Paint', menuIcon: getIcon('paint', iconSize), content: <PaintContent currentOS={currentOS} />, hideMenuBar: true },
    { id: 'media', title: currentOS === 'winxp' ? 'Windows Media Player' : 'Windows Media Player - 1995 Hits', menuIcon: getIcon('media', iconSize), content: <MediaPlayerContent currentOS={currentOS} />, hideMenuBar: true },
  ];

  const closeWindow = (id) => {
    // Stop music when media player is closed
    if (id === 'media') {
      stop();
    }
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

  // Choose components based on current OS
  const WindowComponent = currentOS === 'winxp' ? WindowXP : Window95;
  const StartMenuComponent = currentOS === 'winxp' ? StartMenuXP : StartMenu95;
  const TaskbarComponent = currentOS === 'winxp' ? TaskbarXP : Taskbar95;
  const DesktopIconComponent = currentOS === 'winxp' ? DesktopIconXP : DesktopIcon95;
  const desktopBgStyle = currentOS === 'winxp' 
    ? { 
        backgroundImage: 'url(/ebmujj5y92q01.jpg)', 
        backgroundSize: 'cover', 
        backgroundPosition: 'center',
        backgroundColor: '#3A6EA5' 
      } 
    : { backgroundColor: '#008080' };

  return (
    <div 
      className="w-full h-screen relative overflow-hidden select-none"
      style={desktopBgStyle}
      onClick={() => { setSelectedIcon(null); setIsStartOpen(false); }}
    >
      {/* Desktop icons grid - hidden on mobile when a window is open */}
      {(!isMobile || !Object.values(windows).some(w => w.isOpen && !w.isMinimized)) && (
        <div 
          className="absolute inset-0" 
          style={{ bottom: taskbarHeight }}
          onClick={(e) => e.stopPropagation()}
        >
          {desktopIcons.map((item) => (
            <DraggableDesktopIcon
              key={item.id}
              iconId={item.id}
              position={iconPositions[item.id] || { col: 0, row: 0 }}
              gridSize={gridSize}
              isMobile={isMobile}
              cellToPixels={cellToPixels}
              pixelsToCell={pixelsToCell}
              isCellOccupied={isCellOccupied}
              onDragEnd={(newPos) => {
                setIconPositions(prev => ({ ...prev, [item.id]: newPos }));
              }}
            >
              <DesktopIconComponent
                icon={item.icon}
                label={item.label}
                isSelected={selectedIcon === item.id}
                onSelect={() => setSelectedIcon(item.id)}
                onClick={() => openApp(item.id)}
                isMobile={isMobile}
              />
            </DraggableDesktopIcon>
          ))}
        </div>
      )}
      
      {/* Windows */}
      {apps.map((app) => (
        windows[app.id]?.isOpen && (
          <WindowComponent
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
            noScroll={app.noScroll}
            noStatusBar={app.noStatusBar}
            allWindows={windows}
            isMobile={isMobile}
            isTouch={isTouch}
          >
            {app.content}
          </WindowComponent>
        )
      ))}
      
      {/* Clippy - hidden on mobile and on XP */}
      {showClippy && !isMobile && currentOS === 'win95' && <Clippy onClose={() => setShowClippy(false)} />}
      
      {/* Start Menu */}
      {isStartOpen && (
        <StartMenuComponent 
          apps={apps} 
          onAppClick={openApp} 
          onClose={() => setIsStartOpen(false)} 
          isMobile={isMobile}
          currentOS={currentOS}
          onOSChange={setCurrentOS}
        />
      )}
      
      {/* Mini Player - shows when media player is minimized */}
      {windows.media?.isOpen && windows.media?.isMinimized && (
        <MiniPlayer
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          position={position}
          duration={duration}
          onTogglePlay={togglePlay}
          onNext={nextTrack}
          onPrev={prevTrack}
          onRestore={() => {
            setWindows(prev => ({ ...prev, media: { ...prev.media, isMinimized: false } }));
            bringToFront('media');
          }}
        />
      )}
      
      {/* Taskbar */}
      <TaskbarComponent 
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
