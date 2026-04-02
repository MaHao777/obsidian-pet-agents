# OBS Pet Agents

`OBS Pet Agents` 是一个运行在 Obsidian 桌面端的社区插件，提供像素宠物风格的多智能体聊天界面，并集成 Codex 任务执行与分层记忆能力。

## 开发

安装依赖：

```powershell
npm install
```

本地构建：

```powershell
npm run build
```

开发模式：

```powershell
npm run dev
```

类型检查：

```powershell
npm run check
```

## 构建与部署

项目根目录：

```text
D:\VS_project\OBS_PetAgents
```

Obsidian 插件目录：

```text
D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents
```

每次修改插件代码后：

1. 在项目根目录执行 `npm run build`
2. 将以下文件覆盖复制到 Obsidian 插件目录
   - `manifest.json`
   - `main.js`
   - `styles.css`
   - `versions.json`

## Obsidian 刷新

复制文件后，按下面顺序刷新：

```powershell
obsidian reload vault=Note
obsidian plugin:enable id=obs-pet-agents filter=community vault=Note
obsidian plugin:reload id=obs-pet-agents vault=Note
obsidian plugin id=obs-pet-agents vault=Note
obsidian plugins:enabled filter=community format=json vault=Note
```

如果 `obsidian reload` 后命令暂时不可用，等待几秒再执行后续命令即可。
