import { handleApi, jsonOk } from "@/lib/api-route";
import { errorResponse } from "@/lib/http";
import {
  IMPORT_COLUMNS,
  IMPORT_COLUMNS_HINT,
  importStudentsCsv,
} from "@/lib/student-import";

export const dynamic = "force-dynamic";

/** 单份名单的限制，避免误传大文件占满内存。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 教务管理员批量导入学生。文件通过 multipart/form-data 的 `file` 字段上传。
 *
 * 表头或整个文件不合格时整体拒绝（400）；行级问题则逐行返回，
 * 单行失败不影响其它行，也不做整体回滚。
 */
export const POST = handleApi(
  { roles: ["administrator"], idParam: null },
  async ({ request }) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("请选择要上传的 CSV 文件。", 400);
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return errorResponse("请选择要上传的 CSV 文件。", 400);
    }
    if (file.size === 0) {
      return errorResponse(`文件为空。${IMPORT_COLUMNS_HINT}`, 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse("CSV 文件不能超过 2 MB。", 400);
    }

    const result = await importStudentsCsv(await file.text());
    if (!result.ok) {
      return jsonOk(
        { error: result.error, expectedColumns: IMPORT_COLUMNS },
        400,
      );
    }

    return jsonOk(result.result);
  },
);
