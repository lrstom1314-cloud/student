import type { AccountRole } from "@/db/schema";
import { createAccount } from "@/lib/accounts";
import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse, isUniqueViolation } from "@/lib/http";
import {
  displayNameProblem,
  hashPassword,
  loginNameProblem,
  passwordProblem,
} from "@/lib/password";

export const dynamic = "force-dynamic";

const ROLES: readonly AccountRole[] = ["student", "teacher", "administrator"];

function isRole(value: unknown): value is AccountRole {
  return typeof value === "string" && ROLES.includes(value as AccountRole);
}

/**
 * 教务管理员创建账号。初始密码由管理员设置，账号首次登录必须改密。
 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null, body: "optional" },
  async ({ body }) => {
    const loginName =
      typeof body?.loginName === "string" ? body.loginName.trim() : "";
    const displayName =
      typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role = body?.role;

    const loginNameError = loginNameProblem(loginName);
    if (loginNameError) return errorResponse(loginNameError, 400);

    const displayNameError = displayNameProblem(displayName);
    if (displayNameError) return errorResponse(displayNameError, 400);

    if (!isRole(role)) {
      return errorResponse("请选择有效的角色。", 400);
    }

    const passwordError = passwordProblem(password);
    if (passwordError) return errorResponse(passwordError, 400);

    try {
      const account = await createAccount({
        loginName,
        displayName,
        role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      });

      return jsonOk({ account }, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return errorResponse("登录名已被使用，请换一个。", 409);
      }
      throw error;
    }
  },
);
