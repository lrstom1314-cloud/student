import { handleApi } from "@/lib/api-route";
import { buildGradeExport, contentDisposition } from "@/lib/grade-export";
import { errorResponse, NO_STORE } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 导出教学班成绩表：UTF-8 带 BOM 的 CSV，Excel 直接打开不乱码。
 *
 * 有发布快照时永远导出快照（解锁期间也一样），并在解锁期间标注
 * 「解锁中·内容为上次发布」；从未发布过的教学班才导出实时草稿并标注「未发布」。
 */
export const GET = handleApi(
  { idError: "教学班不存在。" },
  async ({ id, user }) => {
    const result = await buildGradeExport(id!, user);
    if (!result.ok) return errorResponse(result.error, result.status);

    const bytes = new TextEncoder().encode(result.export.content);
    return new Response(bytes, {
      headers: {
        ...NO_STORE,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": contentDisposition(result.export.filename),
      },
    });
  },
);
