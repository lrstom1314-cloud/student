# 领域文档

工程技能在探索代码库时应如何消费本仓库的领域文档。

本仓库为**单上下文**布局：根目录一份 `GLOSSARY.md`，决策放在 `docs/adr/`。若将来出现 `GLOSSARY-MAP.md`，则说明已拆为多上下文，此时按其指向逐个读取各 `GLOSSARY.md`。

## 探索之前先读

- 根目录 **`GLOSSARY.md`**。
- **`docs/adr/`**：读取与即将改动的区域相关的 ADR。

这些文件若不存在，**静默继续**。不要提示缺失，也不要主动建议先建起来 —— `/domain-modeling` 技能（通过 `/grill-with-docs`、`/improve-codebase-architecture` 触达）会在术语或决策真正定案时才按需创建。

## 使用术语表的词汇

当你的产出要命名某个领域概念时（issue 标题、重构提案、假设、测试名），使用 `GLOSSARY.md` 中定义的词，不要漂移到它明确列在 _Avoid_ 下的同义词。

若需要的概念尚不在术语表中，这是一个信号：要么你在发明项目并不使用的语言（应重新考虑），要么这里存在真实缺口（记下来交给 `/domain-modeling`）。

## 遇到 ADR 冲突要指出

若你的产出与某条 ADR 矛盾，明确点出来，而不是悄悄覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重开讨论，因为……_

## 文件结构

```
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   ├── 0001-course-and-teaching-class.md
│   │   ├── 0002-single-tenant.md
│   │   └── 0003-typescript-monolith-postgres.md
│   ├── agents/          ← 本目录，供 agent 读取的配置
│   └── operations.md
└── src/
```

## 测试缝的例外

规格要求「只有一条测试缝：HTTP 边界」。这条规则的**例外**只有一种，且已被允许：

- 直连数据库（`tests/support/db.ts` 的 `queryRows` 等）可以用于**准备夹具**与**断言持久化结果**，例如「密码是 Argon2id 哈希」「总评确实落库为 null」。
- 不得用直连 SQL **替代** HTTP 断言来验证业务行为。一个行为若能从响应里看出来，就必须从响应里看。

换句话说：数据库是**观察持久化副作用**的窗口，不是绕过接口的捷径。审查时按这条判断，不要把合法的夹具查询当成违规。
