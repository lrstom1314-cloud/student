import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PRUNE = path.join(ROOT, "scripts/backup-prune.sh");

const tempDirs = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "student-backup-test-"));
  tempDirs.push(dir);
  return dir;
}

/** 把文件的修改时间设成若干天前，模拟历史备份。 */
function ageFile(file, days) {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  utimesSync(file, when, when);
}

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BACKUP = path.join(ROOT, "scripts/backup.sh");

/** 造一个假的 pg_dump，让备份脚本的真实控制流可以在没有 PostgreSQL 客户端的机器上被验证。 */
function fakePgDump(dir, body) {
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "pg_dump");
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return bin;
}

function today() {
  const now = new Date();
  const iso = now.toISOString();
  return iso.slice(0, 10);
}

function readStatus(dir) {
  const status = readFileSync(path.join(dir, ".last-backup"), "utf8").trim();
  const [state, , ...rest] = status.split(" ");
  return { state, status, rest: rest.join(" ") };
}

describe("每日备份（scripts/backup.sh）", () => {
  it("调用 pg_dump 生成按日期命名的文件，写入成功状态并复制到异地目录", () => {
    const dir = tempDir();
    const bin = fakePgDump(
      dir,
      `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --file=*) out="\${arg#--file=}" ;;
  esac
done
[ -n "\${out:-}" ] || { echo "缺少 --file" >&2; exit 90; }
printf 'FAKE-CUSTOM-DUMP\\n' > "$out"
`,
    );
    const backupDir = path.join(dir, "backups");
    const offsiteDir = path.join(dir, "offsite");

    const result = run("sh", [BACKUP], {
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "postgres://fake/fake",
      BACKUP_DIR: backupDir,
      BACKUP_OFFSITE_DIR: offsiteDir,
      BACKUP_RETENTION_DAYS: "30",
    });

    assert.equal(result.status, 0, result.stderr);
    const name = `student-${today()}.dump`;
    assert.equal(readFileSync(path.join(backupDir, name), "utf8"), "FAKE-CUSTOM-DUMP\n");
    assert.equal(readFileSync(path.join(offsiteDir, name), "utf8"), "FAKE-CUSTOM-DUMP\n");

    const status = readStatus(backupDir);
    assert.equal(status.state, "ok");
    assert.match(status.status, new RegExp(name));

    assert.match(result.stderr, /备份完成/);
    assert.equal(readdirSync(backupDir).filter((f) => f.endsWith(".tmp")).length, 0);
  });

  it("pg_dump 失败时非零退出、可读日志、不留半成品，并记录 failed 状态", () => {
    const dir = tempDir();
    const bin = fakePgDump(
      dir,
      `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --file=*) out="\${arg#--file=}" ;;
  esac
done
printf '半截内容' > "\${out:-/dev/null}"
echo "连接到数据库失败：连接被拒绝" >&2
exit 1
`,
    );
    const backupDir = path.join(dir, "backups");
    const offsiteDir = path.join(dir, "offsite");

    const result = run("sh", [BACKUP], {
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "postgres://fake/fake",
      BACKUP_DIR: backupDir,
      BACKUP_OFFSITE_DIR: offsiteDir,
      BACKUP_RETENTION_DAYS: "30",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /备份失败/);
    assert.match(result.stderr, /连接被拒绝/);
    assert.deepEqual(
      readdirSync(backupDir).filter((f) => f.endsWith(".dump")),
      [],
    );
    assert.deepEqual(
      readdirSync(backupDir).filter((f) => f.endsWith(".tmp")),
      [],
    );
    assert.equal(readStatus(backupDir).state, "failed");
  });

  it("备份成功后按保留天数清理旧备份", () => {
    const dir = tempDir();
    const bin = fakePgDump(
      dir,
      `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --file=*) out="\${arg#--file=}" ;;
  esac
done
printf 'FAKE\\n' > "$out"
`,
    );
    const backupDir = path.join(dir, "backups");
    const offsiteDir = path.join(dir, "offsite");
    mkdirSync(backupDir, { recursive: true });
    const old = path.join(backupDir, "student-2025-01-01.dump");
    writeFileSync(old, "old");
    ageFile(old, 40);

    const result = run("sh", [BACKUP], {
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "postgres://fake/fake",
      BACKUP_DIR: backupDir,
      BACKUP_OFFSITE_DIR: offsiteDir,
      BACKUP_RETENTION_DAYS: "30",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(backupDir).filter((f) => f.endsWith(".dump")), [
      `student-${today()}.dump`,
    ]);
  });
});

const ENTRYPOINT = path.join(ROOT, "scripts/backup-entrypoint.sh");

describe("备份容器入口（scripts/backup-entrypoint.sh）", () => {
  it("先执行一次备份，再写入 cron 计划并前台启动 crond", () => {
    const dir = tempDir();
    const bin = fakePgDump(
      dir,
      `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --file=*) out="\${arg#--file=}" ;;
  esac
done
printf 'FAKE\\n' > "$out"
`,
    );

    const crontab = path.join(dir, "crontab");
    const capture = path.join(dir, "crontab-seen");
    const crond = path.join(bin, "crond");
    writeFileSync(
      crond,
      `#!/bin/sh
cp "$CRONTAB_FILE" "$CRON_CAPTURE"
printf 'crond %s\\n' "$*" >> "$CRON_CAPTURE"
`,
    );
    chmodSync(crond, 0o755);

    const backupDir = path.join(dir, "backups");
    const result = run("sh", [ENTRYPOINT], {
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "postgres://fake/fake",
      BACKUP_DIR: backupDir,
      BACKUP_OFFSITE_DIR: "",
      BACKUP_SCHEDULE: "15 3 * * *",
      CRONTAB_FILE: crontab,
      CROND_BIN: crond,
      CRON_CAPTURE: capture,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(backupDir, `student-${today()}.dump`), "utf8"), "FAKE\n");
    assert.match(
      readFileSync(capture, "utf8"),
      new RegExp(`15 3 \\* \\* \\* sh ${ROOT.replaceAll("/", "\\/")}/scripts/backup.sh >> /proc/1/fd/1 2>&1`),
    );
  });
});

const HEALTHCHECK = path.join(ROOT, "scripts/backup-healthcheck.sh");

describe("备份失败的可发现信号（scripts/backup-healthcheck.sh）", () => {
  function seed(dir, state, ageMinutes, withDump = true) {
    mkdirSync(dir, { recursive: true });
    const status = path.join(dir, ".last-backup");
    writeFileSync(status, `${state} 2026-11-17T03:00:00Z student-x.dump\n`);
    const when = new Date(Date.now() - ageMinutes * 60 * 1000);
    utimesSync(status, when, when);
    if (withDump) {
      const dump = path.join(dir, "student-x.dump");
      writeFileSync(dump, "dump");
      utimesSync(dump, when, when);
    }
  }

  it("最近一次备份成功且在 36 小时内时健康", () => {
    const dir = tempDir();
    seed(dir, "ok", 60);

    const result = run("sh", [HEALTHCHECK], { BACKUP_DIR: dir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /最近一次备份成功/);
  });

  it("最近一次备份失败时判定为不健康并输出原因", () => {
    const dir = tempDir();
    seed(dir, "failed", 5);

    const result = run("sh", [HEALTHCHECK], { BACKUP_DIR: dir });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /最近一次备份失败/);
  });

  it("备份成功状态超过 36 小时未更新时判定为不健康", () => {
    const dir = tempDir();
    seed(dir, "ok", 40 * 60);

    const result = run("sh", [HEALTHCHECK], { BACKUP_DIR: dir });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /超过/);
  });

  it("没有任何备份记录时判定为不健康", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });

    const result = run("sh", [HEALTHCHECK], { BACKUP_DIR: dir });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /尚无备份记录/);
  });
});

describe("备份保留策略（scripts/backup-prune.sh）", () => {
  it("删除超过保留天数的学生备份，保留较新的备份与无关文件", () => {
    const dir = tempDir();
    const expired = path.join(dir, "student-2025-01-01.dump");
    const recent = path.join(dir, "student-2026-11-16.dump");
    const unrelated = path.join(dir, "notes.txt");
    writeFileSync(expired, "old");
    writeFileSync(recent, "new");
    writeFileSync(unrelated, "keep");
    ageFile(expired, 40);
    ageFile(unrelated, 40);

    const result = run("sh", [PRUNE, dir, "30"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ["notes.txt", "student-2026-11-16.dump"]);
  });

  it("--dry-run 只报告将删除的文件，不实际删除", () => {
    const dir = tempDir();
    const expired = path.join(dir, "student-2025-01-01.dump");
    writeFileSync(expired, "old");
    ageFile(expired, 40);

    const result = run("sh", [PRUNE, dir, "30", "--dry-run"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /student-2025-01-01\.dump/);
    assert.equal(readdirSync(dir).length, 1);
  });

  it("保留天数按天计算：29 天前保留，31 天前删除", () => {
    const dir = tempDir();
    const inside = path.join(dir, "student-inside.dump");
    const outside = path.join(dir, "student-outside.dump");
    writeFileSync(inside, "inside");
    writeFileSync(outside, "outside");
    ageFile(inside, 29);
    ageFile(outside, 31);

    const result = run("sh", [PRUNE, dir, "30"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(dir), ["student-inside.dump"]);
  });

  it("目录不存在时报错退出，而不是静默成功", () => {
    const dir = path.join(tempDir(), "missing");

    const result = run("sh", [PRUNE, dir, "30"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /备份目录不存在/);
  });
});
