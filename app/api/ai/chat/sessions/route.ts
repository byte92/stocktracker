import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { safeReadJsonBody } from '@/lib/api/request'
import { normalizeChatTitle } from '@/lib/ai/chat'
import { withApiLogging } from '@/lib/observability/api'
import { clearAiDataByUserId, deleteAiChatSession, getAiChatSession, listAiChatSessions, saveAiChatSession, updateAiChatSessionTitle } from '@/lib/sqlite/db'

type CreateBody = {
  userId?: string
  title?: string
}

type DeleteBody = {
  userId?: string
  sessionId?: string
  all?: boolean
}

type PatchBody = {
  userId?: string
  sessionId?: string
  title?: string
}

async function handleGET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  return NextResponse.json({ sessions: listAiChatSessions(userId) })
}

async function handlePOST(request: Request) {
  try {
    const payload = await safeReadJsonBody<CreateBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    }

    const id = randomUUID()
    saveAiChatSession({
      id,
      userId: body.userId,
      title: normalizeChatTitle(body.title ?? ''),
      scope: 'portfolio',
    })

    return NextResponse.json({ session: listAiChatSessions(body.userId).find((session) => session.id === id) })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建 AI 对话失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function handlePATCH(request: Request) {
  try {
    const payload = await safeReadJsonBody<PatchBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId || !body.sessionId) {
      return NextResponse.json({ error: '缺少用户 ID 或会话 ID' }, { status: 400 })
    }

    const title = normalizeChatTitle(body.title ?? '')
    updateAiChatSessionTitle(body.userId, body.sessionId, title)
    const session = getAiChatSession(body.userId, body.sessionId)
    if (!session) {
      return NextResponse.json({ error: '未找到对应的 AI 对话' }, { status: 404 })
    }
    return NextResponse.json({ session })
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新 AI 对话失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function handleDELETE(request: Request) {
  try {
    const payload = await safeReadJsonBody<DeleteBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    }

    if (body.all) {
      clearAiDataByUserId(body.userId)
      return NextResponse.json({ ok: true })
    }

    if (!body.sessionId) {
      return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 })
    }

    const deleted = deleteAiChatSession(body.userId, body.sessionId)
    if (!deleted) {
      return NextResponse.json({ error: '未找到对应的 AI 对话' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除 AI 对话失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const GET = withApiLogging(NEXT_API_ROUTES.ai.chatSessions, handleGET)
export const POST = withApiLogging(NEXT_API_ROUTES.ai.chatSessions, handlePOST)
export const PATCH = withApiLogging(NEXT_API_ROUTES.ai.chatSessions, handlePATCH)
export const DELETE = withApiLogging(NEXT_API_ROUTES.ai.chatSessions, handleDELETE)
