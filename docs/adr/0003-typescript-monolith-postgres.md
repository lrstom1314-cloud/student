# TypeScript 单体应用 + PostgreSQL，单机部署

用一个 Next.js（App Router）应用同时承担页面与服务端逻辑，数据存 PostgreSQL，通过 Docker Compose 部署在单台云服务器上，每日 `pg_dump` 备份保留 30 天并异地留存一份。一所学校的数据量在单机 Postgres 的舒适区内，拆成独立前后端或引入消息队列只增加运维面而不带来收益。代价是横向扩展需要额外架构工作，且应用与数据库共享同一台机器的故障域。
