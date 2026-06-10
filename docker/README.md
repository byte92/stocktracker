# Docker 部署

本文档说明如何把 StockTracker 作为 Docker 服务运行，并发布到 GitHub Container Registry。

## 使用公开镜像启动

如果需要修改宿主机端口，可以准备 Docker 编排配置：

```bash
cd docker
cp .env.example .env
```

没有 `docker/.env` 时也可以直接启动，宿主机端口默认使用 `3218`：

```bash
cd docker
docker compose up -d
```

启动后访问：

- 默认端口：[http://localhost:3218](http://localhost:3218)
- 如果 `docker/.env` 中设置了 `HOST_PORT`，访问 `http://localhost:${HOST_PORT}`

如果需要 AI/API Key 等业务配置，请在项目根目录准备 `.env.local`：

```bash
cp .env.example .env.local
```

`docker/docker-compose.yml` 会可选读取 `../.env.local` 并把这些业务变量注入容器。应用代码仍然通过 `process.env.AI_API_KEY`、`process.env.AI_MODEL` 等方式读取。

默认数据会保存在当前目录的 `data/finance.sqlite` 中，也就是：

```text
docker/data/finance.sqlite
```

容器重启后不会丢失，备份或迁移时复制整个 `docker/data` 目录即可。

默认情况下，`docker-compose.yml` 会从 GHCR 拉取公开镜像：

```text
ghcr.io/byte92/stocktracker:latest
```

如需指定其它 tag 或镜像源，可以在 `docker/.env` 中设置：

```dotenv
DOCKER_IMAGE=ghcr.io/byte92/stocktracker:main-84ee3a6
```

如果需要更新到最新镜像：

```bash
docker compose pull
docker compose up -d
```

## 本地构建

如果希望在本机重新构建镜像，请编辑 `docker/docker-compose.yml`，取消 `build` 配置的注释，然后运行：

```bash
cd docker
docker compose up -d --build
```

## 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止服务；不会删除 docker/data 下的本地数据
docker compose down
```

## 写入失败排查

如果页面提示“本地数据服务暂时不可用”，并且浏览器控制台里看到
`PUT /api/storage 500`，通常是 SQLite 数据文件所在的数据目录权限异常。
新版镜像启动时会自动修正 `/app/data` 的属主后再降权运行。更新镜像后重启即可：

```bash
docker compose pull
docker compose up -d
```

如果使用本地构建镜像，请重新构建：

```bash
docker compose up -d --build
```

## 直接运行公开镜像

公开镜像发布在 GitHub Container Registry：

```text
ghcr.io/byte92/stocktracker
```

可以直接拉取运行：

```bash
HOST_PORT=${HOST_PORT:-3218}

docker run -d \
  --name stocktracker \
  --restart unless-stopped \
  -p "${HOST_PORT}:3218" \
  -e PORT=3218 \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/byte92/stocktracker:latest
```

如果需要传入 AI/API Key 等业务配置，可以额外加上 `--env-file ../.env.local`。

## 发布镜像

镜像通过 GitHub Actions 发布到 GHCR：

- 合入 `main`：发布 `latest` 和 `main-<short-sha>`。
- 推送 `v*` tag：发布对应语义化版本 tag，例如 `1.0.0`、`1.0` 和 `v1.0.0`。
- 也可以在 GitHub Actions 中手动触发 `Publish Docker Image`。

如果需要本地临时发布，可以使用：

```bash
docker login ghcr.io
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f Dockerfile \
  -t ghcr.io/byte92/stocktracker:latest \
  --push \
  ..
```

建议同时发布：

- `latest`：最新稳定版本。
- `x.y.z`：语义化版本标签。

## 数据与隐私

容器内默认数据库路径：

```text
/app/data/finance.sqlite
```

`docker/docker-compose.yml` 会把这个目录绑定挂载到 `docker/data`。请不要把真实 SQLite 数据库打进镜像，也不要把包含真实 API Key 的 `.env.local`、包含本地编排偏好的 `docker/.env` 或 `docker/data` 下的数据库文件提交到仓库。

## 架构说明

Docker 镜像使用 Next.js standalone 输出：

```text
pnpm install --frozen-lockfile -> pnpm build -> Chromium headless shell -> .next/standalone -> node server.js
```

应用运行时需要 Playwright 的 Chromium 来执行 `web.search` 等公开网页检索能力。镜像不会直接基于完整的 Playwright 官方镜像，而是基于 Node slim，并在运行层只安装 Chromium headless shell 和它需要的系统依赖：

- 避免打包 Firefox / WebKit 等当前业务未使用的浏览器。
- 保持 Playwright package 版本和浏览器版本由 `pnpm-lock.yaml` 统一锁定。
- 使用 Docker BuildKit cache 缓存 pnpm store 和 Next.js build cache，让重复构建更快。

`docker-compose.yml` 同时启用了 `init: true` 和 `shm_size: "1gb"`，用于减少长时间运行或 Chromium 启动时的僵尸进程和共享内存问题。
