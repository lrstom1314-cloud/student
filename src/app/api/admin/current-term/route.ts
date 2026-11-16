import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";
import { getCurrentTerm, getTermById, setCurrentTerm } from "@/lib/terms";

export const dynamic = "force-dynamic";

/**
 * 把某个学期设为全局唯一的当前学期。
 *
 * 这是会影响所有人的切换，接口要求显式 confirmed=true：
 * 未确认时返回 409 与可展示给教务管理员的确认文案，前端据此弹出确认。
 */
export async function POST(request: Request) {
  const guard = await requireApiUser({ roles: ["administrator"] });
  if (!guard.ok) return guard.response;

  const body = await readJsonObject(request);
  const termId = body?.termId;

  if (!isUuid(termId)) {
    return errorResponse("请选择要设为当前学期的学期。", 400);
  }

  try {
    const target = await getTermById(termId);
    if (!target) {
      return errorResponse("学期不存在，请刷新页面后重试。", 404);
    }

    const current = await getCurrentTerm();
    if (body?.confirmed !== true) {
      return NextResponse.json(
        {
          error: current
            ? `切换当前学期会改变所有人的默认视图：从「${current.label}」切换为「${target.label}」。请确认后再提交。`
            : `设置当前学期会改变所有人的默认视图：将「${target.label}」设为当前学期。请确认后再提交。`,
          confirmationRequired: true,
          currentTerm: current,
          targetTerm: target,
        },
        { status: 409, headers: NO_STORE },
      );
    }

    const updated = await setCurrentTerm(termId);
    if (!updated) {
      return errorResponse("学期不存在，请刷新页面后重试。", 404);
    }

    return NextResponse.json(
      { currentTerm: updated },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError(error);
  }
}
