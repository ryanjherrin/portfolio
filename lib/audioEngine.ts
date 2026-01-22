'use client'

import { useAudioStore } from './stores/audioStore'

// YouTube IFrame Player types
declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string,
        config: {
          height: string
          width: string
          videoId: string
          playerVars?: Record<string, number | string>
          events?: {
            onReady?: (event: { target: YTPlayer }) => void
            onStateChange?: (event: { data: number; target: YTPlayer }) => void
            onError?: (event: { data: number }) => void
          }
        }
      ) => YTPlayer
      PlayerState: {
        UNSTARTED: number
        ENDED: number
        PLAYING: number
        PAUSED: number
        BUFFERING: number
        CUED: number
      }
    }
    onYouTubeIframeAPIReady: () => void
  }
}

interface YTPlayer {
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
  getVolume: () => number
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  loadVideoById: (videoId: string) => void
  cueVideoById: (videoId: string) => void
  destroy: () => void
}

class AudioEngine {
  private static instance: AudioEngine | null = null
  private player: YTPlayer | null = null
  private isAPIReady = false
  private pendingVideoId: string | null = null
  private currentVideoId: string | null = null
  private timeUpdateInterval: ReturnType<typeof setInterval> | null = null
  private containerElement: HTMLDivElement | null = null
  
  // Local audio support
  private localAudio: HTMLAudioElement | null = null
  private currentSource: 'youtube' | 'local' | null = null
  
  // Error delay - don't show errors immediately to avoid flashing
  private errorTimeout: ReturnType<typeof setTimeout> | null = null

  private constructor() {
    if (typeof window !== 'undefined') {
      this.loadYouTubeAPI()
      this.initLocalAudio()
    }
  }
  
  private clearErrorTimeout() {
    if (this.errorTimeout) {
      clearTimeout(this.errorTimeout)
      this.errorTimeout = null
    }
  }
  
  private setErrorWithDelay(message: string, delayMs: number = 3000) {
    this.clearErrorTimeout()
    this.errorTimeout = setTimeout(() => {
      useAudioStore.getState().setError(message)
    }, delayMs)
  }
  
  private initLocalAudio() {
    this.localAudio = new Audio()
    this.localAudio.addEventListener('play', () => {
      this.clearErrorTimeout() // Cancel pending error
      useAudioStore.getState().setIsPlaying(true)
      useAudioStore.getState().setIsLoading(false)
      useAudioStore.getState().setError(null) // Clear any previous errors
      this.startLocalTimeUpdate()
    })
    this.localAudio.addEventListener('pause', () => {
      useAudioStore.getState().setIsPlaying(false)
    })
    this.localAudio.addEventListener('ended', () => {
      useAudioStore.getState().setIsPlaying(false)
      this.stopTimeUpdate()
      this.playNextTrack()
    })
    this.localAudio.addEventListener('loadedmetadata', () => {
      useAudioStore.getState().setDuration(this.localAudio?.duration || 0)
      useAudioStore.getState().setIsLoading(false)
    })
    this.localAudio.addEventListener('error', () => {
      this.setErrorWithDelay('Failed to load audio file', 3000)
      useAudioStore.getState().setIsLoading(false)
    })
  }
  
  private startLocalTimeUpdate() {
    this.stopTimeUpdate()
    this.timeUpdateInterval = setInterval(() => {
      if (this.localAudio) {
        useAudioStore.getState().setPosition(this.localAudio.currentTime)
      }
    }, 250)
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine()
    }
    return AudioEngine.instance
  }

  private loadYouTubeAPI() {
    // Check if already loaded
    if (window.YT && window.YT.Player) {
      this.isAPIReady = true
      this.initPlayer()
      return
    }

    // Set up callback for when API is ready
    window.onYouTubeIframeAPIReady = () => {
      this.isAPIReady = true
      this.initPlayer()
      // Note: pending video is loaded in onPlayerReady, not here
    }

    // Load the API script
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    const firstScriptTag = document.getElementsByTagName('script')[0]
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)
  }

  private initPlayer() {
    if (!this.isAPIReady || this.player) return

    // Create hidden container for YouTube player
    this.containerElement = document.createElement('div')
    this.containerElement.id = 'youtube-player-container'
    this.containerElement.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;'
    document.body.appendChild(this.containerElement)

    const playerDiv = document.createElement('div')
    playerDiv.id = 'youtube-player'
    this.containerElement.appendChild(playerDiv)

    this.player = new window.YT.Player('youtube-player', {
      height: '1',
      width: '1',
      videoId: '',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
      },
      events: {
        onReady: this.onPlayerReady.bind(this),
        onStateChange: this.onPlayerStateChange.bind(this),
        onError: this.onPlayerError.bind(this),
      },
    })
  }

  private onPlayerReady(event: { target: YTPlayer }) {
    const store = useAudioStore.getState()
    event.target.setVolume(store.volume * 100)
    
    // Load pending video if any
    if (this.pendingVideoId) {
      this.loadYouTube(this.pendingVideoId)
      this.pendingVideoId = null
    } else {
      store.setIsLoading(false)
    }
  }

  private onPlayerStateChange(event: { data: number; target: YTPlayer }) {
    const store = useAudioStore.getState()
    const state = event.data

    switch (state) {
      case window.YT.PlayerState.PLAYING:
        this.clearErrorTimeout() // Cancel pending error
        store.setIsPlaying(true)
        store.setIsLoading(false)
        store.setError(null) // Clear any previous errors
        this.startTimeUpdate()
        break
      case window.YT.PlayerState.PAUSED:
        store.setIsPlaying(false)
        this.stopTimeUpdate()
        break
      case window.YT.PlayerState.ENDED:
        store.setIsPlaying(false)
        this.stopTimeUpdate()
        // Auto-advance to next track
        this.playNextTrack()
        break
      case window.YT.PlayerState.BUFFERING:
        store.setIsLoading(true)
        break
      case window.YT.PlayerState.CUED:
        store.setIsLoading(false)
        // Get duration when video is cued
        if (this.player) {
          const duration = this.player.getDuration()
          if (duration > 0) {
            store.setDuration(duration)
          }
        }
        break
    }
  }

  private onPlayerError(event: { data: number }) {
    const store = useAudioStore.getState()
    let errorMessage = 'Playback error'
    
    switch (event.data) {
      case 2:
        errorMessage = 'Invalid video ID'
        break
      case 5:
        errorMessage = 'HTML5 player error'
        break
      case 100:
        errorMessage = 'Video not found or private'
        break
      case 101:
      case 150:
        errorMessage = 'Video not embeddable'
        break
    }
    
    // Use delayed error to avoid flashing during retries
    this.setErrorWithDelay(errorMessage, 2000)
    store.setIsLoading(false)
    store.setIsPlaying(false)
  }

  private startTimeUpdate() {
    this.stopTimeUpdate()
    this.timeUpdateInterval = setInterval(() => {
      if (this.player) {
        const store = useAudioStore.getState()
        const currentTime = this.player.getCurrentTime()
        const duration = this.player.getDuration()
        
        store.setPosition(currentTime)
        if (duration > 0 && store.duration !== duration) {
          store.setDuration(duration)
        }
      }
    }, 250) // Update 4 times per second
  }

  private stopTimeUpdate() {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval)
      this.timeUpdateInterval = null
    }
  }

  private playNextTrack() {
    const store = useAudioStore.getState()
    const { currentIndex, queue } = store
    const nextIndex = currentIndex + 1 < queue.length ? currentIndex + 1 : 0
    
    if (queue.length === 0) return
    
    const nextTrack = queue[nextIndex]
    store.playTrack(nextIndex)
    
    // Load and play the next track
    if (nextTrack.source === 'local' && nextTrack.audioUrl) {
      this.loadLocal(nextTrack.audioUrl)
    } else if (nextTrack.youtubeId) {
      this.loadYouTube(nextTrack.youtubeId)
    }
  }

  loadYouTube(youtubeId: string) {
    this.currentSource = 'youtube'
    // Stop local audio if playing
    if (this.localAudio) {
      this.localAudio.pause()
      this.localAudio.src = ''
    }
    
    if (!this.isAPIReady) {
      this.pendingVideoId = youtubeId
      useAudioStore.getState().setIsLoading(true)
      return
    }

    if (!this.player) {
      this.initPlayer()
      this.pendingVideoId = youtubeId
      return
    }

    this.currentVideoId = youtubeId
    this.clearErrorTimeout() // Clear any pending errors
    useAudioStore.getState().setIsLoading(true)
    useAudioStore.getState().setError(null)
    this.player.loadVideoById(youtubeId)
  }
  
  loadLocal(audioUrl: string) {
    this.currentSource = 'local'
    // Stop YouTube if playing
    if (this.player) {
      this.player.stopVideo()
    }
    this.stopTimeUpdate()
    this.clearErrorTimeout() // Clear any pending errors
    
    if (!this.localAudio) {
      this.initLocalAudio()
    }
    
    useAudioStore.getState().setIsLoading(true)
    useAudioStore.getState().setError(null)
    
    // Auto-play once audio is ready (similar to YouTube's loadVideoById behavior)
    const playOnReady = async () => {
      try {
        await this.localAudio!.play()
      } catch (error) {
        // Browser may block autoplay - user will need to click play again
        useAudioStore.getState().setError('Click play to start audio')
        useAudioStore.getState().setIsPlaying(false)
      }
    }
    this.localAudio!.addEventListener('canplaythrough', playOnReady, { once: true })
    
    this.localAudio!.src = audioUrl
    this.localAudio!.load()
  }
  
  // Legacy method for compatibility
  load(youtubeId: string) {
    this.loadYouTube(youtubeId)
  }

  async play(): Promise<void> {
    if (this.currentSource === 'local' && this.localAudio) {
      try {
        await this.localAudio.play()
        useAudioStore.getState().setIsPlaying(true)
      } catch (error) {
        useAudioStore.getState().setError('Click play to start audio')
        useAudioStore.getState().setIsPlaying(false)
      }
    } else if (this.player) {
      try {
        this.player.playVideo()
        useAudioStore.getState().setIsPlaying(true)
      } catch (error) {
        useAudioStore.getState().setError('Click play to start audio')
        useAudioStore.getState().setIsPlaying(false)
      }
    }
  }

  pause() {
    if (this.currentSource === 'local' && this.localAudio) {
      this.localAudio.pause()
      useAudioStore.getState().setIsPlaying(false)
    } else if (this.player) {
      this.player.pauseVideo()
      useAudioStore.getState().setIsPlaying(false)
    }
  }

  stop() {
    if (this.currentSource === 'local' && this.localAudio) {
      this.localAudio.pause()
      this.localAudio.currentTime = 0
    } else if (this.player) {
      this.player.stopVideo()
    }
    useAudioStore.getState().setIsPlaying(false)
    useAudioStore.getState().setPosition(0)
    this.stopTimeUpdate()
  }

  seek(seconds: number) {
    if (this.currentSource === 'local' && this.localAudio) {
      this.localAudio.currentTime = seconds
      useAudioStore.getState().setPosition(seconds)
    } else if (this.player) {
      this.player.seekTo(seconds, true)
      useAudioStore.getState().setPosition(seconds)
    }
  }

  setVolume(volume: number) {
    const vol = Math.max(0, Math.min(1, volume))
    if (this.localAudio) {
      this.localAudio.volume = vol
    }
    if (this.player) {
      // YouTube uses 0-100, we use 0-1
      this.player.setVolume(vol * 100)
    }
  }
  
  getCurrentSource() {
    return this.currentSource
  }

  destroy() {
    this.stopTimeUpdate()
    if (this.player) {
      this.player.destroy()
      this.player = null
    }
    if (this.containerElement) {
      this.containerElement.remove()
      this.containerElement = null
    }
    this.currentVideoId = null
  }
}

// Export singleton getter
export const getAudioEngine = () => AudioEngine.getInstance()

// React hook to connect store to audio engine
export function useAudioEngine() {
  const {
    currentTrack,
    isPlaying,
    volume,
    position,
  } = useAudioStore()

  // Sync volume changes to audio element
  const setVolume = (v: number) => {
    useAudioStore.getState().setVolume(v)
    getAudioEngine().setVolume(v)
  }

  // Seek in audio
  const seek = (pos: number) => {
    useAudioStore.getState().seek(pos)
    getAudioEngine().seek(pos)
  }

  // Play/pause toggle
  const togglePlay = () => {
    const engine = getAudioEngine()
    const store = useAudioStore.getState()
    
    if (isPlaying) {
      engine.pause()
    } else {
      // If no track is loaded, start with the first track
      if (!store.currentTrack && store.queue.length > 0) {
        const firstTrack = store.queue[0]
        store.playTrack(0)
        if (firstTrack.source === 'local' && firstTrack.audioUrl) {
          engine.loadLocal(firstTrack.audioUrl)
        } else if (firstTrack.youtubeId) {
          engine.loadYouTube(firstTrack.youtubeId)
        }
        engine.setVolume(store.volume)
      } else {
        engine.play()
      }
    }
  }

  // Stop playback
  const stop = () => {
    getAudioEngine().stop()
    useAudioStore.getState().stop()
  }

  // Load and play a track
  const playTrack = (index: number) => {
    const store = useAudioStore.getState()
    const track = store.queue[index]
    if (!track) return

    store.playTrack(index)
    const engine = getAudioEngine()
    
    // Load based on track source
    if (track.source === 'local' && track.audioUrl) {
      engine.loadLocal(track.audioUrl)
    } else if (track.youtubeId) {
      engine.loadYouTube(track.youtubeId)
    }
    engine.setVolume(store.volume)
  }

  // Next/prev
  const nextTrack = () => {
    const store = useAudioStore.getState()
    const nextIndex = store.currentIndex + 1
    if (nextIndex < store.queue.length) {
      playTrack(nextIndex)
    } else {
      playTrack(0) // Loop
    }
  }

  const prevTrack = () => {
    const store = useAudioStore.getState()
    // If more than 3 seconds in, restart current track
    if (position > 3) {
      seek(0)
    } else {
      const prevIndex = store.currentIndex - 1
      if (prevIndex >= 0) {
        playTrack(prevIndex)
      }
    }
  }

  return {
    currentTrack,
    isPlaying,
    volume,
    position,
    setVolume,
    seek,
    togglePlay,
    stop,
    playTrack,
    nextTrack,
    prevTrack,
  }
}
