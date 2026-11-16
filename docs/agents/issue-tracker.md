# Issue tracker: GitHub

本仓库的问题单（issue）与规格（spec）都以 GitHub issue 的形式存在。所有操作使用 `gh` CLI。

仓库：`lrstom1314-cloud/student`。在克隆目录内执行时 `gh` 会自动推断仓库，无需重复指定。

## 约定

- **创建问题单**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读取问题单**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出问题单**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合 `--label` 与 `--state` 过滤。
- **把问题单设为父单的子单**：`gh issue create --parent <parent> ...`，或事后执行 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。旧版本：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（使用数据库 id，见下文 **阻塞** 一节）。若子单功能不可用，在子单正文顶部写 `Part of #<parent>`。
- **阻塞关系**：使用 GitHub 原生 issue 依赖，这是唯一在界面上可见的标准表示。添加边：`gh issue create --blocked-by <n>,<n> ...`，或 `gh issue edit <child> --add-blocked-by <blocker>`（`gh` 2.94+）。旧版本：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞方的数值 **数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，不是 `#number`，也不是 `node_id`）。环境不支持依赖时，回退为子单正文顶部的 `Blocked by: #<n>, #<n>` 行。所有阻塞项关闭后，该单才算解锁。
- **统计未关闭的阻塞数**：`gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只统计未关闭项；结果为 0 表示可以开工）。`gh issue view <n> --json blockedBy` 会包含已关闭项，需过滤：`--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`。
- **评论**：`gh issue comment <number> --body "..."`。
- **加/去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **关闭**：先用 `gh issue comment <number> --body "..."` 说明原因，再 `gh issue close <number>`。对已关闭的单执行 `gh issue close --comment` 会丢弃评论但仍以 0 退出。

只向用户自己的仓库提交问题单。绝不提交到 `mattpocock/skills`（这些技能的来源仓库），除非用户就是它的所有者。在 fork 中 `gh` 可能默认指向上游父仓库，因此每次会话首次 `gh issue create` 之前，用 `gh repo view --json nameWithOwner` 检查目标仓库，若不属于用户则先确认。

## Pull request 作为分诊入口

**把 PR 视为需求入口：否。** _（若本仓库把外部 PR 当作功能请求，改为 `是`；`/triage` 会读取此标记。）_

设为 `是` 时，PR 走与 issue 相同的标签与状态流转，命令换成 `gh pr` 等价物：

- **读取 PR**：`gh pr view <number>`，再看 `gh pr view <number> --comments`（非 TTY 下 `--comments` 只输出评论、不输出正文），以及 `gh pr diff <number>`。
- **列出待分诊的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用一套编号，因此裸写 `#42` 可能指任意一种：先用 `gh pr view 42` 解析，失败再回退到 `gh issue view 42`。

## 当某个技能要求「发布到 issue tracker」

创建一条 GitHub issue。

## 当某个技能要求「取出相关工单」

按上文的 **读取问题单** 处理。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图（map）** 是一条 issue，**子工单** 是它的子单。

- **地图**：一条带 `wayfinder:map` 标签的 issue，正文承载 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子工单**：作为地图的子单创建（见上文 **把问题单设为父单的子单**）。子单功能不可用时，改为在地图正文的任务清单里登记，并在子单顶部写 `Part of #<map>`。标签用 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。认领后指派给负责推进的人。
- **阻塞**：见上文 **阻塞关系**。
- **前沿查询**：列出地图下所有未关闭的子单（`gh issue list --state open`，限定于子单或任务清单），剔除存在未关闭阻塞项的单（见 **统计未关闭的阻塞数**，或 `Blocked by` 行中未关闭的单）以及已被指派的单；剩余按地图顺序取第一条。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写操作。
- **解决**：`gh issue comment <n> --body "<答案>"`，然后 `gh issue close <n>`，再把上下文指针（gist + 链接）追加到地图的 Decisions-so-far 里。
