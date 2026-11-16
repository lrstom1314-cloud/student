# student

单体、单机构的教务系统。领域词汇见 `GLOSSARY.md`，架构决策见 `docs/adr/`。

## Agent skills

### Issue tracker

任务单以 GitHub Issues 形式管理，通过 `gh` CLI 操作。见 `docs/agents/issue-tracker.md`。

### Triage labels

分诊使用五个标准标签，沿用默认命名（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `GLOSSARY.md` 配合 `docs/adr/`。见 `docs/agents/domain.md`。
