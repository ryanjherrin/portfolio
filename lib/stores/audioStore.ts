'use client'

import { create } from 'zustand'

export type TrackSource = 'youtube' | 'local'

export type Track = {
  id: string
  title: string
  artist: string
  duration: string // formatted as "m:ss"
  durationSec: number
  source: TrackSource
  youtubeId?: string // for YouTube tracks
  audioUrl?: string // for local tracks (blob URL or data URL)
  albumArt?: string // optional custom album art URL
}

export type Album = {
  id: string
  name: string
  tracks: Track[]
}

export type AudioState = {
  // Playback state
  queue: Track[]
  currentTrack: Track | null
  currentIndex: number
  isPlaying: boolean
  position: number // current time in seconds
  duration: number // total duration in seconds
  volume: number // 0-1
  isLoading: boolean
  error: string | null
  
  // Album state
  currentAlbumId: string
  albums: Album[]

  // Actions
  setQueue: (tracks: Track[]) => void
  playTrack: (index: number) => void
  togglePlay: () => void
  stop: () => void
  nextTrack: () => void
  prevTrack: () => void
  seek: (position: number) => void
  setVolume: (volume: number) => void
  setPosition: (position: number) => void
  setDuration: (duration: number) => void
  setIsPlaying: (isPlaying: boolean) => void
  setIsLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void
  
  // Album actions
  setCurrentAlbum: (albumId: string) => void
  addAlbum: (album: Album) => void
  addTrackToAlbum: (albumId: string, track: Track) => void
  removeTrackFromAlbum: (albumId: string, trackId: string) => void
}

export const useAudioStore = create<AudioState>((set, get) => ({
  // Initial state
  queue: [],
  currentTrack: null,
  currentIndex: -1,
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 0.75,
  isLoading: false,
  error: null,
  
  // Album state
  currentAlbumId: '1995-hits',
  albums: [],

  // Actions
  setQueue: (tracks) => set({ queue: tracks }),

  playTrack: (index) => {
    const { queue } = get()
    if (index < 0 || index >= queue.length) return
    
    const track = queue[index]
    set({
      currentTrack: track,
      currentIndex: index,
      position: 0,
      isPlaying: true,
      isLoading: true,
      error: null,
    })
  },

  togglePlay: () => {
    const { isPlaying, currentTrack } = get()
    if (!currentTrack) return
    set({ isPlaying: !isPlaying })
  },

  stop: () => {
    set({
      isPlaying: false,
      position: 0,
      currentTrack: null,
      currentIndex: -1,
    })
  },

  nextTrack: () => {
    const { currentIndex, queue } = get()
    const nextIndex = currentIndex + 1
    if (nextIndex < queue.length) {
      get().playTrack(nextIndex)
    } else {
      // Loop back to start
      get().playTrack(0)
    }
  },

  prevTrack: () => {
    const { currentIndex, position } = get()
    // If more than 3 seconds in, restart current track
    if (position > 3) {
      set({ position: 0 })
    } else {
      const prevIndex = currentIndex - 1
      if (prevIndex >= 0) {
        get().playTrack(prevIndex)
      }
    }
  },

  seek: (position) => {
    set({ position })
  },

  setVolume: (volume) => {
    set({ volume: Math.max(0, Math.min(1, volume)) })
  },

  setPosition: (position) => {
    set({ position })
  },

  setDuration: (duration) => {
    set({ duration })
  },

  setIsPlaying: (isPlaying) => {
    set({ isPlaying })
  },

  setIsLoading: (isLoading) => {
    set({ isLoading })
  },

  setError: (error) => {
    set({ error, isLoading: false })
  },
  
  // Album actions
  setCurrentAlbum: (albumId) => {
    const { albums } = get()
    const album = albums.find(a => a.id === albumId)
    if (album) {
      set({ 
        currentAlbumId: albumId, 
        queue: album.tracks,
        currentTrack: null,
        currentIndex: -1,
        position: 0,
        isPlaying: false,
      })
    } else {
      set({ currentAlbumId: albumId })
    }
  },
  
  addAlbum: (album) => {
    set(state => ({ albums: [...state.albums, album] }))
  },
  
  addTrackToAlbum: (albumId, track) => {
    set(state => ({
      albums: state.albums.map(album => 
        album.id === albumId 
          ? { ...album, tracks: [...album.tracks, track] }
          : album
      ),
      // If this is the current album, update the queue too
      queue: state.currentAlbumId === albumId 
        ? [...state.queue, track]
        : state.queue,
    }))
  },
  
  removeTrackFromAlbum: (albumId, trackId) => {
    set(state => ({
      albums: state.albums.map(album => 
        album.id === albumId 
          ? { ...album, tracks: album.tracks.filter(t => t.id !== trackId) }
          : album
      ),
      // If this is the current album, update the queue too
      queue: state.currentAlbumId === albumId 
        ? state.queue.filter(t => t.id !== trackId)
        : state.queue,
    }))
  },
}))
