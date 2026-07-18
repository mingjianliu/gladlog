# gladlog Windows 安装指南(AI 教练走 Claude CLI,免 API Key)

> 适用:Windows 10/11,有 Claude Pro/Max 订阅(或 Claude Code 可登录账号)的用户。
> AI 分析走本地 Claude CLI,不需要另买 Anthropic API Key。

## 1. 安装 gladlog

1. 打开 <https://github.com/mingjianliu/gladlog/releases/latest>
2. 下载 `gladlog.Setup.x.x.x.exe`,双击安装。
   - Windows SmartScreen 可能提示"未知发布者"→ 点「更多信息」→「仍要运行」
     (开源项目未做付费签名,属正常)。

## 2. 安装 Claude CLI(Claude Code)

1. 先装 Node.js:<https://nodejs.org> 下载 LTS 版一路下一步。
2. 打开 PowerShell(开始菜单搜 powershell),执行:

   ```powershell
   npm install -g @anthropic-ai/claude-code
   ```

3. 登录(浏览器会弹出授权页,用你的 Claude 账号登录):

   ```powershell
   claude
   ```

   首次运行会引导登录;登录完随便问一句确认能回答,然后 `/exit` 退出。

4. 验证命令可被找到:

   ```powershell
   where claude
   ```

   有输出路径即可。gladlog 会自动用 `where` 找到它(`.cmd` 包装脚本也支持)。

## 3. 配置 gladlog

1. 启动 gladlog → 按首启引导**选择 WoW 安装目录**
   (通常 `C:\Program Files (x86)\World of Warcraft\_retail_`)。
2. 顶部「设置」页:
   - **后端** → 选「**Claude CLI(本地)**」。不用填 API Key。
   - 命令留空即可(自动 `where claude`);装在非常规位置才需要手填完整路径。
   - **教练回复语言** → 中文 / EN 随意。

## 4. 游戏内开启战斗记录(关键!)

1. WoW 系统设置 → 网络 → 勾选 **高级战斗日志(Advanced Combat Logging)**。
   没开这个就没有坐标/HP 采样——回放走位、死亡回顾、走位分析全都没有。
2. 进竞技场前输入 `/combatlog` 开启记录(推荐装个自动开关插件,
   比如 AutoCombatLogger,进竞技场自动开)。

## 5. 使用

- 打完的对局会自动出现在左侧列表(app 实时监控 `Logs\WoWCombatLog*.txt`)。
- 老日志:设置页「导入历史日志…」多选旧的 `WoWCombatLog*.txt`,重复导入自动去重。
- 打开一场 → 「AI 分析」页生成教练点评(走你本地登录的 Claude,计入订阅用量,
  不产生 API 账单)。

## 常见问题

| 症状                 | 处理                                                           |
| -------------------- | -------------------------------------------------------------- |
| 回放说"无位置数据"   | 该场没开高级战斗日志(见第 4 步)                                |
| AI 分析没反应        | PowerShell 跑 `where claude` 确认有输出;重新 `claude` 登录一次 |
| 战绩页想按角色分开看 | 「开发者」页点一次「重建对局索引」回填旧场次的角色字段         |
| SmartScreen 拦截安装 | 更多信息 → 仍要运行                                            |
