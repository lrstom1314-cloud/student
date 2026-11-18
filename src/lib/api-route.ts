import { NextResponse } from "next/server";

import type { AccountRole } from "@/db/schema";
import { requireApiUser, type SessionUser } from "@/lib/auth";
import {
  errorResponse,
  internalError,
  isUuid,
  NO_STORE,
  readJsonObject,
} from "@/lib/http";

/**
 * route 外壳 module。
 *
 * 会话、角色、路径 UUID、JSON 请求体与错误映射只在这里处理一次；
 * route 文件只声明自己要什么（角色 / 路径参数 / 请求体）与业务处理函数。
 */

export type ApiContext = {
  request: Request;
  user: SessionUser;
  params: Record<string, string>;
  /** 声明了 idParam 时是校验过的 UUID；未声明时为 null。 */
  id: string | null;
  /** 声明了 body 时是 JSON 对象；未声明时为 null。 */
  body: Record<string, unknown> | null;
};

export type ApiRouteOptions = {
  roles?: readonly AccountRole[];
  allowMustChange?: boolean;
  /** 路径参数名；默认 "id"，传 null 表示不读取路径参数。 */
  idParam?: string | null;
  /** 路径参数不是 UUID 时的 404 文案。 */
  idError?: string;
  /** 是否读取 JSON 对象请求体：true 要求必填，"optional" 只尝试读取。 */
  body?: boolean | "optional";
};

type RouteContext = { params: Promise<Record<string, string>> };

export function handleApi(
  options: ApiRouteOptions,
  handler: (context: ApiContext) => Promise<Response> | Response,
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    const guard = await requireApiUser({
      roles: options.roles,
      allowMustChange: options.allowMustChange,
    });
    if (!guard.ok) return guard.response;

    const params = context?.params ? await context.params : {};

    let id: string | null = null;
    if (options.idParam !== null) {
      const name = options.idParam ?? "id";
      const raw = params[name];
      if (!isUuid(raw)) {
        return errorResponse(options.idError ?? "资源不存在。", 404);
      }
      id = raw;
    }

    let body: Record<string, unknown> | null = null;
    if (options.body === true) {
      body = await readJsonObject(request);
      if (!body) return errorResponse("请求内容无法识别。", 400);
    } else if (options.body === "optional") {
      body = await readJsonObject(request);
    }

    try {
      return await handler({
        request,
        user: guard.user,
        params,
        id,
        body,
      });
    } catch (error) {
      return internalError(error);
    }
  };
}

/** 统一的无缓存 JSON 响应。 */
export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}
