import { NextRequest, NextResponse } from 'next/server'

// This API is no longer used - we use YouTube IFrame Player instead
// Keeping for potential future use

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: 'YouTube IFrame Player is used instead. This endpoint is deprecated.' },
    { status: 410 }
  )
}

// Also provide video info endpoint
export async function POST(request: NextRequest) {
  try {
    const { videoId } = await request.json()

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return NextResponse.json(
        { error: 'Invalid video ID' },
        { status: 400 }
      )
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`
    const info = await ytdl.getInfo(url)

    return NextResponse.json({
      title: info.videoDetails.title,
      author: info.videoDetails.author.name,
      duration: parseInt(info.videoDetails.lengthSeconds),
      thumbnail: info.videoDetails.thumbnails[0]?.url,
    })
  } catch (error) {
    console.error('YouTube info error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch video info' },
      { status: 500 }
    )
  }
}
