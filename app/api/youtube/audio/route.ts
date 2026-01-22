import { NextResponse } from 'next/server'

// This API is no longer used - we use YouTube IFrame Player instead

export async function GET() {
  return NextResponse.json(
    { error: 'YouTube IFrame Player is used instead. This endpoint is deprecated.' },
    { status: 410 }
  )
}

export async function POST() {
  return NextResponse.json(
    { error: 'YouTube IFrame Player is used instead. This endpoint is deprecated.' },
    { status: 410 }
  )
}
